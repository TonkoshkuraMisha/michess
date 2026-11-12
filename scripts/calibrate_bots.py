"""
Калибровка силы ботов матчами с настоящим Stockfish (таск 10.4). Не для CI: долго и нужен движок.

Каждый бот (7 исторических и 10 архетипов мастерской) играет:
* с «якорями» — Stockfish с UCI_LimitStrength и фиксированным UCI_Elo (ближайшие к заявленному рейтингу);
* с соседями по заявленной силе — так слабые боты, которых не с кем сравнить среди якорей (Stockfish
  слабее 1320 не играет), получают рейтинг по цепочке.
Каждая пара играет дебютную позицию за обе стороны. Рейтинги подбираются по всем партиям сразу
(максимум правдоподобия по Эло, якоря зафиксированы — как в Ordo/BayesElo) с лёгким априорным
«одним ничейным результатом» против заявленного рейтинга, чтобы 0 из N не давало минус бесконечности.

Шкала — шкала UCI_Elo Stockfish при нашем контроле времени, а не FIDE: сравнивать с ней можно ботов
между собой и с якорями. Результат: src/services/bots/calibration.json (рейтинг, партии, ±95 %).

    python scripts/calibrate_bots.py --rounds 1 --workers 3
    python scripts/calibrate_bots.py --only morphy --rounds 2
"""

import argparse
import json
import math
import os
import random
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ANCHOR_ELOS = (1350, 1600, 1850, 2100, 2400)
ANCHOR_MOVETIME_S = 0.1
MAX_PLIES = 180
ADJUDICATE_CP = 400
# Короткие уравновешенные дебюты — чтобы партии одной пары не повторялись ход в ход.
OPENINGS = (
    "e4 e5 Nf3 Nc6",
    "d4 d5 c4 e6",
    "e4 c5 Nf3 d6",
    "d4 Nf6 c4 g6",
    "e4 e6 d4 d5",
    "c4 e5 Nc3 Nf6",
    "e4 c6 d4 d5",
    "Nf3 d5 g3 Nf6",
)
OUT = ROOT / "src" / "services" / "bots" / "calibration.json"


@dataclass(frozen=True)
class Spec:
    white: str
    black: str
    opening: int


def declared_ratings() -> dict[str, int]:
    from src.api.bots import AVAILABLE_BOTS
    from src.services.bots.archetypes import ARCHETYPES

    ratings = {b["id"]: int(b["rating"]) for b in AVAILABLE_BOTS}
    ratings.update({a.key: a.config.target_elo for a in ARCHETYPES})
    return ratings


# --- Игроки (создаются в процессе-работнике) ---------------------------------------------------

_ENGINES: dict[str, chess.engine.SimpleEngine] = {}


def _engine(name: str, options: dict) -> chess.engine.SimpleEngine:
    from src.services.bots.base import resolve_stockfish_path

    if name not in _ENGINES:
        path = resolve_stockfish_path()
        if not path:
            raise SystemExit("Stockfish не найден: python scripts/setup_stockfish.py")
        engine = chess.engine.SimpleEngine.popen_uci(path)
        engine.configure({"Threads": 1, "Hash": 16, **options})
        _ENGINES[name] = engine
    return _ENGINES[name]


def _bot(key: str):
    from src.services.bots import BOT_INSTANCES
    from src.services.bots.archetypes import ARCHETYPES_BY_KEY
    from src.services.bots.personality import PersonalityBot

    if key.startswith("archetype:"):
        return PersonalityBot(ARCHETYPES_BY_KEY[key].config)
    return BOT_INSTANCES[key]


def _move(player: str, board: chess.Board) -> chess.Move:
    if player.startswith("anchor:"):
        elo = int(player.split(":")[1])
        engine = _engine(player, {"UCI_LimitStrength": True, "UCI_Elo": elo})
        return engine.play(board, chess.engine.Limit(time=ANCHOR_MOVETIME_S)).move
    return chess.Move.from_uci(_bot(player).choose_move(board.fen())["uci"])


def _adjudicate(board: chess.Board) -> str:
    """Незавершённая к MAX_PLIES партия: решает полный Stockfish (перевес больше 4 пешек), иначе ничья."""
    judge = _engine("judge", {})
    score = judge.analyse(board, chess.engine.Limit(time=0.2))["score"].white().score(mate_score=100000)
    if score is not None and score > ADJUDICATE_CP:
        return "1-0"
    if score is not None and score < -ADJUDICATE_CP:
        return "0-1"
    return "1/2-1/2"


def play_game(spec: Spec) -> tuple[Spec, str, int]:
    board = chess.Board()
    for san in OPENINGS[spec.opening % len(OPENINGS)].split():
        board.push_san(san)
    while not board.is_game_over(claim_draw=True) and board.ply() < MAX_PLIES:
        player = spec.white if board.turn == chess.WHITE else spec.black
        board.push(_move(player, board))
    result = board.result(claim_draw=True) if board.is_game_over(claim_draw=True) else _adjudicate(board)
    return spec, result, board.ply()


# --- Расписание и подбор рейтингов ------------------------------------------------------------

def schedule(declared: dict[str, int], rounds: int, only: set[str] | None) -> list[Spec]:
    bots = sorted(declared, key=lambda k: declared[k])
    specs: list[Spec] = []
    pairs: set[tuple[str, str]] = set()
    for i, bot in enumerate(bots):
        if only and bot not in only:
            continue
        anchors = sorted(ANCHOR_ELOS, key=lambda e: abs(e - declared[bot]))[:3]
        opponents = [f"anchor:{e}" for e in anchors]
        opponents += [b for b in bots[max(0, i - 2):i + 3] if b != bot]  # соседи по заявленной силе
        for opp in opponents:
            pair = tuple(sorted((bot, opp)))
            if pair in pairs:
                continue
            pairs.add(pair)
            for r in range(rounds):
                opening = random.randrange(len(OPENINGS)) if r else hash(pair) % len(OPENINGS)
                specs += [Spec(bot, opp, opening), Spec(opp, bot, opening)]
    return specs


SCORES = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}
_LOG_LINE = re.compile(r"^\[\d+/\d+\] (\S+) — (\S+): (1-0|0-1|1/2-1/2) ")


def games_from_log(path: Path) -> list[tuple[str, str, float]]:
    """Партии из вывода прошлого прогона: «[n/N] белые — чёрные: результат (… пл.)»."""
    games = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _LOG_LINE.match(line)
        if match:
            games.append((match.group(1), match.group(2), SCORES[match.group(3)]))
    return games


def expected(ra: float, rb: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))


def fit(games: list[tuple[str, str, float]], declared: dict[str, int]) -> dict[str, dict]:
    """Рейтинги ботов по всем партиям; якоря фиксированы. games: (белые, чёрные, очки белых)."""
    fixed = {f"anchor:{e}": float(e) for e in ANCHOR_ELOS}
    players = {p for w, b, _ in games for p in (w, b) if p not in fixed}
    rating = {p: float(declared.get(p, 1500)) for p in players}
    rating.update(fixed)

    for step in range(4000):
        lr = 40.0 if step < 1000 else 10.0 if step < 3000 else 2.0
        grad = {p: 0.0 for p in players}
        for w, b, s in games:
            e = expected(rating[w], rating[b])
            if w in grad:
                grad[w] += s - e
            if b in grad:
                grad[b] += (1 - s) - (1 - e)
        for p in players:
            # Априор: одна «ничья» против заявленного рейтинга.
            grad[p] += 0.5 - expected(rating[p], declared.get(p, 1500))
            rating[p] += lr * grad[p] / max(1, sum(1 for w, b, _ in games if p in (w, b)))

    result = {}
    scale = 400 / math.log(10)
    for p in players:
        own = [(w, b, s) for w, b, s in games if p in (w, b)]
        info = sum(expected(rating[w], rating[b]) * (1 - expected(rating[w], rating[b])) for w, b, _ in own)
        score = sum(s if w == p else 1 - s for w, b, s in own)
        result[p] = {
            "rating": round(rating[p]),
            "games": len(own),
            "score": score,
            "ci95": round(1.96 * scale / math.sqrt(info)) if info > 0 else None,
            "declared": declared.get(p),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rounds", type=int, default=1, help="Партий каждой пары за каждый цвет")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--only", nargs="*", help="Калибровать только этих (id или archetype:<id>)")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--from-log", type=Path, help="Пересчитать рейтинги по логу прошлого прогона, без партий")
    args = parser.parse_args()

    random.seed(20261112)
    declared = declared_ratings()

    started = time.monotonic()
    pool = None
    if args.from_log:
        games = games_from_log(args.from_log)
        print(f"{len(games)} партий из {args.from_log}", flush=True)
    else:
        specs = schedule(declared, args.rounds, set(args.only) if args.only else None)
        print(f"{len(specs)} партий, {args.workers} процесса", flush=True)
        games = []
        pool = ProcessPoolExecutor(max_workers=args.workers)
        futures = [pool.submit(play_game, spec) for spec in specs]
        for done, future in enumerate(as_completed(futures), 1):
            spec, result, plies = future.result()
            games.append((spec.white, spec.black, SCORES[result]))
            print(f"[{done}/{len(specs)}] {spec.white} — {spec.black}: {result} ({plies} пл.)", flush=True)

    fitted = fit(games, declared)
    previous = {}
    if args.out.exists():
        previous = json.loads(args.out.read_text(encoding="utf-8")).get("players", {})
    payload = {
        "meta": {
            "date": datetime.now(UTC).strftime("%Y-%m-%d"),
            "games": len(games),
            "anchors": list(ANCHOR_ELOS),
            "anchor_movetime_s": ANCHOR_MOVETIME_S,
            "minutes": round((time.monotonic() - started) / 60, 1),
            "scale": "Stockfish UCI_Elo при нашем контроле времени",
        },
        "players": {**previous, **fitted},
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for key, entry in sorted(fitted.items(), key=lambda kv: kv[1]["rating"]):
        print(f"{key:28} {entry['rating']:5} ±{entry['ci95']}  (заявлено {entry['declared']}, "
              f"{entry['score']}/{entry['games']})", flush=True)

    if pool is not None:
        # Работники держат открытые процессы Stockfish (и их потоки) — штатный shutdown пула ждал бы
        # их вечно. Результат уже записан, поэтому работников просто завершаем.
        for process in list(getattr(pool, "_processes", {}).values()):
            process.terminate()
        pool.shutdown(wait=False, cancel_futures=True)
        os._exit(0)


if __name__ == "__main__":
    main()
