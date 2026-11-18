# --- FILE: scripts/build_classics.py ---
"""
Партии мастеров с объяснениями (таск 14.7): отбор партий из архива и разметка движком.

Кандидаты — архивные партии, где отбор «Угадай ход мастера» (таблица guess_positions, scripts/build_guess_positions.py)
нашёл моменты у победителя: результативные, 20–70 ходов, разные пары соперников, не больше --per-player партий одного
победителя. Для каждой партии движок оценивает каждую позицию; к ходам с ошибкой или с тактической идеей наставник
(src/services/coach.py) пишет объяснение кодами каталога coach.*; моменты отбора становятся остановками «что бы вы
сыграли?» (с сохранёнными строками движка — ответ оценивается без сервера).

Результат — frontend/src/content/classics/<id>.json: ходы, оценки, комментарии, остановки и пустые места для
вводного и итогового текстов (их пишет автор курса на трёх языках; при повторном запуске тексты сохраняются).

    python scripts/build_classics.py --count 30 --workers 8
"""

import argparse
import asyncio
import io
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import chess
import chess.engine
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

OUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "content" / "classics"
ARCHIVE_PASSWORD = "!historical_archive_no_login!"
MATE = 100000
MIN_MOVES, MAX_MOVES = 20, 70
LANGUAGES = ("en", "uk", "ru")
# Не для учебной подборки: партия, вокруг которой шёл публичный спор о честности игры.
EXCLUDED = ("carlsen-niemann-2022",)
# Классика — партии с классическим контролем: быстрые, онлайновые, гандикапные и показательные события не берём.
NOT_CLASSICAL = re.compile(
    r"blitz|rapid|bullet|speed|online|chess\.com|chess24|titled|tuesday|\d-0|handicap|simul|armageddon|"
    r"meltwater|tour final|chessable|goldmoney|aimchess|airthings|champions chess|banter|lichess|blind|basque|"
    r"fischer ?random|chess960|exhibition|veterans|clutch|\bko\b|\d+'",
    re.IGNORECASE,
)


def _slug(white: str, black: str, year: str) -> str:
    """Формирует строковый идентификатор классической партии по игрокам и году."""
    def last(name: str) -> str:
        """Извлекает фамилию шахматиста в нижнем регистре из заголовка PGN."""
        return re.sub(r"[^a-z0-9]+", "-", name.split(",")[0].strip().lower()).strip("-")
    return f"{last(white)}-{last(black)}-{year}"


async def _candidates(count: int, per_player: int, exclude: set[str]) -> list[dict]:
    """Отбирает результативные классические партии чемпионов из архива."""
    from sqlalchemy import func, select

    from scripts.build_guess_positions import _sessions
    from src.models.game import Game
    from src.models.guess import GuessPosition

    engine, sessions = _sessions()
    async with sessions() as db:
        rows = (await db.execute(
            select(Game.id, Game.pgn, func.array_agg(GuessPosition.ply), func.array_agg(GuessPosition.id))
            .join(GuessPosition, GuessPosition.game_id == Game.id).group_by(Game.id, Game.pgn)
        )).all()
        stops = {}
        for row in (await db.execute(select(GuessPosition))).scalars():
            stops.setdefault(row.game_id, []).append(
                {"ply": row.ply, "move": row.move_uci, "best_cp": row.best_cp, "gap_cp": row.gap_cp, "lines": row.lines})
    await engine.dispose()

    scored = []
    for game_id, pgn, _plies, _ids in rows:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if game is None:
            continue
        if NOT_CLASSICAL.search(game.headers.get("Event", "")):
            continue
        result = game.headers.get("Result")
        moves = list(game.mainline_moves())
        if result not in ("1-0", "0-1") or not MIN_MOVES * 2 <= len(moves) <= MAX_MOVES * 2:
            continue
        winner_parity = 0 if result == "1-0" else 1
        own = [s for s in stops[game_id] if s["ply"] % 2 == winner_parity]
        if len(own) < 2:
            continue
        winner = game.headers["White" if result == "1-0" else "Black"]
        scored.append((len(own), game_id, game, winner, sorted(own, key=lambda s: s["ply"])))
    scored.sort(key=lambda item: (-item[0], item[1]))

    chosen: list[dict] = []
    per_winner: dict[str, int] = {}
    pairs: set[frozenset[str]] = set()
    for _, game_id, game, winner, own in scored:
        year = (game.headers.get("Date") or "????")[:4]
        if _slug(game.headers["White"], game.headers["Black"], year) in exclude:
            continue
        pair = frozenset((game.headers["White"], game.headers["Black"]))
        if pair in pairs or per_winner.get(winner, 0) >= per_player:
            continue
        pairs.add(pair)
        per_winner[winner] = per_winner.get(winner, 0) + 1
        chosen.append({"game_id": game_id, "pgn": str(game), "stops": own})
        if len(chosen) >= count:
            break
    return chosen


def _cp(score: chess.engine.PovScore, color: chess.Color) -> int:
    """Переводит оценку позиции движком в сантипешки с точки зрения ходящего."""
    return score.pov(color).score(mate_score=MATE) or 0


def analyse(item: dict, depth: int) -> dict:
    """Разбирает партию движком, формируя оценки, комментарии и остановки."""
    from src.services.analysis_service import classify_move_by_cp_loss
    from src.services.bots.base import resolve_stockfish_path
    from src.services.coach import comment_for_move

    game = chess.pgn.read_game(io.StringIO(item["pgn"]))
    assert game is not None
    moves = list(game.mainline_moves())
    engine = chess.engine.SimpleEngine.popen_uci(resolve_stockfish_path())
    try:
        engine.configure({"Threads": 1, "Hash": 32})
        board = game.board()
        infos = []
        for move in [*moves, None]:
            if board.is_game_over():
                infos.append(None)
            else:
                info = engine.analyse(board, chess.engine.Limit(depth=depth))
                infos.append({"best": info["pv"][0].uci() if info.get("pv") else None, "score": info["score"]})
            if move is not None:
                board.push(move)
    finally:
        engine.quit()

    board = game.board()
    evals: list[int] = []
    comments: dict[str, dict] = {}
    for ply, move in enumerate(moves):
        before, after = infos[ply], infos[ply + 1]
        mover = board.turn
        best_cp = _cp(before["score"], mover) if before else 0
        if after is None:
            board_after = board.copy()
            board_after.push(move)
            played_cp = MATE if board_after.is_checkmate() else 0
        else:
            played_cp = _cp(after["score"], mover)
        loss = max(0, best_cp - played_cp) if abs(best_cp) < MATE // 2 else 0
        classification, _ = classify_move_by_cp_loss(loss, is_best_move=before is not None and before["best"] == move.uci())
        reply = after["best"] if after else None
        comment = comment_for_move(board, move, before["best"] if before else None, reply, classification)
        if comment:
            comments[str(ply)] = comment
        board.push(move)
        evals.append(played_cp if mover == chess.WHITE else -played_cp)

    headers = game.headers
    year = (headers.get("Date") or "????")[:4]
    return {
        "id": _slug(headers.get("White", "?"), headers.get("Black", "?"), year),
        "white": headers.get("White", "?"), "black": headers.get("Black", "?"),
        "event": headers.get("Event") if headers.get("Event", "?") != "?" else None,
        "year": year if year.isdigit() else None, "result": headers.get("Result"),
        "moves": [m.uci() for m in moves], "evals": evals, "comments": comments, "stops": item["stops"],
    }


def _write(data: dict) -> Path:
    """Записывает размеченные классические партии в JSON-каталог клиента."""
    path = OUT / f"{data['id']}.json"
    texts = {"intro": {lang: "" for lang in LANGUAGES}, "summary": {lang: "" for lang in LANGUAGES}}
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        texts = {key: old.get(key, texts[key]) for key in texts}
    path.write_text(json.dumps({**data, **texts}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def main() -> None:
    """Точка входа скрипта отбора и разметки классических партий мастеров."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument("--per-player", type=int, default=2)
    parser.add_argument("--depth", type=int, default=14)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--exclude", nargs="*", default=list(EXCLUDED), help="id партий, которые не брать")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    chosen = asyncio.run(_candidates(args.count, args.per_player, set(args.exclude)))
    print(f"Выбрано {len(chosen)} партий", flush=True)
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(analyse, item, args.depth) for item in chosen]
        for done, future in enumerate(as_completed(futures), 1):
            data = future.result()
            path = _write(data)
            print(f"[{done}/{len(chosen)}] {path.name}: {len(data['comments'])} комментариев, "
                  f"{len(data['stops'])} остановок", flush=True)


if __name__ == "__main__":
    main()
