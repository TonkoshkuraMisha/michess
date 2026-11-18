"""
Экзамены уровней Большого курса (таск 27.12) → src/services/data/level_exams.json. Не для CI: нужны база задач и
Stockfish.

На каждый уровень 0–5 — фиксированный набор из QUESTIONS позиций по ветвям курса: тактика (T, разделы A–E каталога),
мат и атака (M, F–G), эндшпиль (E, J), стратегия (S, L), расчёт (C, K). Позиции — задачи базы (CC0) около порога
разряда уровня (LEVEL_TARGETS, ±SPREAD). Позиция берётся, только если ответ объективно единственный: первый ход
решения — лучший ход движка с отрывом от второго не меньше GAP_CP, либо мат (тогда засчитывается любой мат).
Набор хранится целиком (позиция, ответ, рейтинг, id задачи в базе) — от базы и её id после сборки не зависит.

    python scripts/build_level_exams.py --time 0.5
"""

import argparse
import asyncio
import json
import random
import sys
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUT = ROOT / "src" / "services" / "data" / "level_exams.json"
LEVEL_TARGETS = (800, 1000, 1200, 1400, 1600, 1800)
SPREAD = 250
# Ветвь → разделы каталога тем и число вопросов (всего 12).
BRANCHES = {"T": ("ABCDE", 4), "M": ("FG", 3), "E": ("J", 2), "S": ("L", 2), "C": ("K", 1)}
GAP_CP = 150
MATE = 100_000
CANDIDATES = 40


async def _candidates(sections: str, low: int, high: int, used: set[str]) -> list[tuple[str, str, str, int]]:
    """Отбирает из базы задачи нужной ветви и рейтинга для экзамена уровня."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.puzzle import Puzzle, PuzzleTheme
    from src.services.themes import THEMES

    codes = [t.code for t in THEMES if t.section in sections]
    # Свой движок базы на каждый asyncio.run: пул общего привязан к уже закрытому циклу событий.
    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    async with engine.connect() as db:
        rows = (await db.execute(
            select(Puzzle.source_id, Puzzle.fen, Puzzle.moves, Puzzle.rating).join(PuzzleTheme)
            .where(PuzzleTheme.theme.in_(codes), Puzzle.rating.between(low, high)).distinct()
        )).all()
    await engine.dispose()
    return [tuple(r) for r in rows if r[0] not in used]  # type: ignore[misc]


def _verified(engine: chess.engine.SimpleEngine, fen: str, moves: str, limit: chess.engine.Limit) -> dict | None:
    """Проверяет движком единственность лучшего хода и полное решение задачи."""
    board = chess.Board(fen)
    first, *rest = moves.split()
    board.push_uci(first)
    answer = chess.Move.from_uci(rest[0])
    infos = engine.analyse(board, limit, multipv=2)
    if not infos or not infos[0].get("pv") or infos[0]["pv"][0] != answer:
        return None
    best = infos[0]["score"].pov(board.turn)
    after = board.copy()
    after.push(answer)
    mate = best.is_mate() and (best.mate() or 0) > 0
    if not mate:
        if len(infos) < 2:
            return None
        gap = best.score(mate_score=MATE) - infos[1]["score"].pov(board.turn).score(mate_score=MATE)
        if gap < GAP_CP:
            return None
    # moves — решение целиком (ход игрока, ответ соперника, …): в тесте оно доигрывается до конца.
    return {"fen": board.fen(), "previous_move": first, "answer": answer.uci(), "moves": rest, "mate": bool(mate)}


def main() -> None:
    """Собирает и сохраняет наборы позиций для экзаменов по уровням курса."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--time", type=float, default=0.5, help="Секунд движка на позицию")
    parser.add_argument("--seed", type=int, default=2712)
    args = parser.parse_args()

    from src.services.bots.base import resolve_stockfish_path

    path = resolve_stockfish_path()
    if not path:
        raise SystemExit("Stockfish не найден: python scripts/setup_stockfish.py")
    rng = random.Random(args.seed)
    limit = chess.engine.Limit(time=args.time)
    used: set[str] = set()
    levels = []
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        for level, target in enumerate(LEVEL_TARGETS):
            questions = []
            for branch, (sections, count) in BRANCHES.items():
                # Рейтинги вопросов ветви — равномерно по окну вокруг порога уровня.
                aims = [target - SPREAD + round(i * 2 * SPREAD / max(1, count - 1)) if count > 1 else target
                        for i in range(count)]
                pool = asyncio.run(_candidates(sections, max(400, target - SPREAD - 150), target + SPREAD + 150, used))
                for aim in aims:
                    pool.sort(key=lambda row: (abs(row[3] - aim), rng.random()))
                    for source_id, fen, moves, rating in pool[:CANDIDATES]:
                        if source_id in used:
                            continue
                        checked = _verified(engine, fen, moves, limit)
                        used.add(source_id)
                        if checked:
                            questions.append({"branch": branch, "rating": rating, "source_id": source_id, **checked})
                            break
                    else:
                        raise SystemExit(f"Уровень {level}, ветвь {branch}: нет проверенной позиции около {aim}")
            questions.sort(key=lambda q: q["rating"])
            levels.append({"level": level, "target": target, "questions": questions})
            print(f"Уровень {level}: {len(questions)} позиций, рейтинги {questions[0]['rating']}–{questions[-1]['rating']}",
                  flush=True)
    OUT.write_text(json.dumps(levels, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"→ {OUT}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    main()
