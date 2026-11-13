# --- FILE: scripts/dev/build_defense_drills.py ---
"""
Сборка защитных упражнений (таск 13.6) → data/puzzles/defense_drills.csv.gz.

Источник — выборка задач lichess (data/puzzles/lichess_subset.csv.gz, CC0). Каждая задача проверяется движком по
критериям решаемости из src/services/defense_drills.py: угроза настоящая, защита существует и она не случайный ход;
в «Не зевни» из трёх естественных ходов не проигрывает ровно один. Затем каждое упражнение независимо
перепроверяется глубже (``--verify-depth``) с чистой памятью движка — нестабильные оценки (эндшпиль, цугцванг)
отсеиваются. Задачи перебираются в детерминированном порядке
(по crc32 номера задачи), пока на каждой ступени каждого вида не наберётся ``--per-stage`` упражнений.

Нужен Stockfish (bin/ или PATH). В CI не запускается: результат — файл в репозитории.

    python -m scripts.dev.build_defense_drills [--per-stage 100] [--depth 12]
"""

import argparse
import time
import zlib
from collections import Counter

import chess
import chess.engine

from src.services.bots.base import resolve_stockfish_path
from src.services.defense_drills import (
    KINDS,
    MATE,
    MoveScores,
    blunder_drill,
    read_drills,
    threat_drill,
    verify_drill,
    write_drills,
)
from src.services.puzzle_import import read_subset, stage_for, themes_for_row
from src.services.puzzles import STAGES


def make_analyse(engine: chess.engine.SimpleEngine, depth: int):
    def analyse(board: chess.Board, multipv: int, moves: list[str] | None) -> MoveScores:
        root = [chess.Move.from_uci(uci) for uci in moves] if moves else None
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv, root_moves=root)
        scores: MoveScores = {}
        for info in infos:
            pv = info.get("pv") or []
            if pv:
                score = info["score"].pov(board.turn).score(mate_score=MATE)
                scores[pv[0].uci()] = (score, pv[1].uci() if len(pv) > 1 else None)
        return scores

    return analyse


def make_score_after(engine: chess.engine.SimpleEngine, depth: int):
    """Оценка после хода — с точки зрения сыгравшего; новая «партия» на каждый вызов: без памяти прошлых поисков."""
    def score_after(fen: str, uci: str) -> int:
        board = chess.Board(fen)
        mover = board.turn
        board.push_uci(uci)
        info = engine.analyse(board, chess.engine.Limit(depth=depth), game=object())
        return info["score"].pov(mover).score(mate_score=MATE)

    return score_after


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-stage", type=int, default=100, help="упражнений каждого вида на каждой ступени")
    parser.add_argument("--depth", type=int, default=12, help="глубина проверки движком")
    parser.add_argument("--shallow-depth", type=int, default=2, help="глубина «на глаз» для естественных ходов")
    parser.add_argument("--verify-depth", type=int, default=16, help="глубина независимой перепроверки")
    parser.add_argument("--keep-existing", action="store_true",
                        help="перепроверить уже собранную выборку и только добрать отбракованное")
    args = parser.parse_args()

    path = resolve_stockfish_path()
    if not path:
        raise SystemExit("Stockfish не найден: python scripts/setup_stockfish.py")
    rows = sorted(read_subset(), key=lambda r: zlib.crc32(r["PuzzleId"].encode()))
    quota = {(kind, stage): args.per_stage for kind in KINDS for stage in STAGES}
    found: list[dict] = []
    checked = Counter[str]()
    rejected = Counter[str]()
    started = time.monotonic()
    reported = 0

    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        engine.configure({"Threads": 2, "Hash": 128})
        evaluate = make_analyse(engine, args.depth)
        shallow = make_analyse(engine, args.shallow_depth)
        score_after = make_score_after(engine, args.verify_depth)
        tried: set[tuple[str, str]] = set()
        if args.keep_existing:
            for old in read_drills():
                tried.add((old["Kind"], old["SourceId"]))
                key = (old["Kind"], int(old["Stage"]))
                if quota.get(key, 0) > 0 and verify_drill(old, score_after):
                    quota[key] -= 1
                    found.append(old)
                else:
                    rejected[old["Kind"]] += 1
            print(f"kept {len(found)} of the existing drills, rejected {dict(rejected)}", flush=True)
        for row in rows:
            if not any(quota.values()):
                break
            moves = row["Moves"].split()
            stage = stage_for(int(row["Rating"]), moves[:2])
            for kind in KINDS:
                if quota[(kind, stage)] <= 0 or (kind, row["PuzzleId"]) in tried:
                    continue
                checked[kind] += 1
                if kind == "threat":
                    drill = threat_drill(row["FEN"], moves, evaluate)
                else:
                    drill = blunder_drill(row["FEN"], moves, evaluate, shallow, seed=row["PuzzleId"])
                if drill is None:
                    continue
                candidate = {
                    "Kind": kind, "SourceId": row["PuzzleId"], "FEN": drill["fen"],
                    "Threat": drill.get("threat", ""), "Choices": " ".join(drill.get("choices", [])),
                    "Refutations": " ".join(f"{m}:{r}" for m, r in drill.get("refutations", {}).items()),
                    "Good": " ".join(drill["good"]), "Rating": row["Rating"], "Stage": stage,
                    "Motifs": " ".join(themes_for_row(row)),
                }
                if not verify_drill(candidate, score_after):
                    rejected[kind] += 1
                    continue
                quota[(kind, stage)] -= 1
                found.append(candidate)
            if len(found) >= reported + 50:
                reported = len(found)
                left = sum(quota.values())
                print(f"{len(found)} drills, {left} left, checked {dict(checked)}, {time.monotonic() - started:.0f}s",
                      flush=True)

    found.sort(key=lambda r: (r["Kind"], int(r["Stage"]), r["SourceId"]))
    for row in found:
        row["Stage"] = int(row["Stage"])
    written = write_drills(found)
    short = {key: n for key, n in quota.items() if n > 0}
    print(f"Written {written} drills in {time.monotonic() - started:.0f}s; checked {dict(checked)}; "
          f"rejected by verification {dict(rejected)}; unfilled {short}")


if __name__ == "__main__":
    main()
