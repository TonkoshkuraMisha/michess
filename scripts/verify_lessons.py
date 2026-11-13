"""
Сверка уроков школы с движком (таск 14.1). Не для CI: нужен Stockfish и время.

Легальность ходов и наличие верных ответов проверяет тест клиента (validateLesson в CI). Этот скрипт проверяет
шахматную правоту: в каждом вопросе «найдите ход»
* каждый верный ответ не хуже лучшего хода движка больше чем на --tolerance сп (мат — только если движок тоже
  видит мат не дольше);
* у лучшего ответа нет соперника рядом: второй по силе ход, которого нет среди ответов, уступает ему не меньше
  --margin сп — иначе вопрос «угадывается», а не решается, и надо добавить этот ход в ответы;
* каждый ход с отдельным «неверным» откликом действительно хуже лучшего не меньше --margin сп.

    python scripts/verify_lessons.py
    python scripts/verify_lessons.py --time 1.0 --only tactics-double-attack
"""

import argparse
import json
import sys
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
LESSONS_DIR = ROOT / "frontend" / "src" / "content" / "lessons"
MATE = 100_000


def score(info: dict, turn: chess.Color) -> int:
    return info["score"].pov(turn).score(mate_score=MATE)


def evaluate(engine: chess.engine.SimpleEngine, board: chess.Board, move: chess.Move, limit) -> int:
    info = engine.analyse(board, limit, root_moves=[move])
    return score(info, board.turn)


def check_position(engine, board: chess.Board, task: dict, limit, tolerance: int, margin: int) -> list[str]:
    problems = []
    infos = engine.analyse(board, limit, multipv=min(5, board.legal_moves.count()))
    lines = [(info["pv"][0], score(info, board.turn)) for info in infos if info.get("pv")]
    best_move, best = lines[0]
    answers = [chess.Move.from_uci(u) for u in task["answers"]]

    answer_scores = {}
    for move in answers:
        value = evaluate(engine, board, move, limit)
        answer_scores[move] = value
        if value < best - tolerance:
            problems.append(f"ответ {move.uci()} хуже лучшего {best_move.uci()} ({value} против {best} сп)")

    top_answer = max(answer_scores.values())
    rivals = [(m, v) for m, v in lines if m not in answers]
    if rivals and rivals[0][1] > top_answer - margin and top_answer < MATE // 2:
        m, v = rivals[0]
        problems.append(f"ход {m.uci()} почти не хуже ответа ({v} против {top_answer} сп) — вопрос угадывается")

    for uci in task.get("wrong", {}):
        move = chess.Move.from_uci(uci)
        value = evaluate(engine, board, move, limit)
        if value > best - margin:
            problems.append(f"«неверный» ход {uci} на самом деле неплох ({value} против {best} сп)")
    return problems


def check_lesson(path: Path, engine, limit, tolerance: int, margin: int) -> list[str]:
    lesson = json.loads(path.read_text(encoding="utf-8"))
    problems = []
    questions = [("шаг", i, s) for i, s in enumerate(lesson["steps"], 1)]
    questions += [("экзамен", i, s) for i, s in enumerate(lesson["exam"], 1)]
    for kind, number, step in questions:
        if step["type"] != "find_move":
            continue
        board = chess.Board(step["fen"])
        for move_number, task in enumerate(step["line"], 1):
            where = f"{lesson['id']}, {kind} {number}, ход {move_number}"
            problems += [f"{where}: {p}" for p in check_position(engine, board, task, limit, tolerance, margin)]
            board.push_uci(task["answers"][0])
            if task.get("reply"):
                board.push_uci(task["reply"])
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--time", type=float, default=0.5, help="Секунд на позицию")
    parser.add_argument("--tolerance", type=int, default=30, help="Насколько верный ответ может уступать лучшему")
    parser.add_argument("--margin", type=int, default=100, help="Отрыв ответа от других ходов")
    parser.add_argument("--only", nargs="*", help="id уроков")
    args = parser.parse_args()

    from src.services.bots.base import resolve_stockfish_path

    path = resolve_stockfish_path()
    if not path:
        raise SystemExit("Stockfish не найден: python scripts/setup_stockfish.py")
    files = sorted(p for p in LESSONS_DIR.glob("*.json") if p.name != "courses.json")
    if args.only:
        files = [p for p in files if p.stem in args.only]

    problems = []
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        for file in files:
            found = check_lesson(file, engine, chess.engine.Limit(time=args.time), args.tolerance, args.margin)
            print(f"{file.stem}: {'OK' if not found else f'{len(found)} замечаний'}", flush=True)
            problems += found
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
