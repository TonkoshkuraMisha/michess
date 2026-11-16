"""
Экзамены уровней Большого курса (таск 27.12): «тест на разряд». На каждый уровень 0–5 — фиксированный набор позиций по
ветвям курса (тактика T, мат и атака M, эндшпиль E, стратегия S, расчёт C) из src/services/data/level_exams.json
(собирает scripts/build_level_exams.py: задачи базы CC0 около порога разряда, ответ проверен движком — единственный).
Тест идёт через тот же протокол, что диагностика 22.0 (/exam/level<n>/questions и /submit): вопрос — id по порядку в
наборе, ответ — один ход (ход решения или любой мат). Итог — оценка силы по формуле Эло (src/services/exam.estimate),
уровень пройден, когда она не ниже порога (клиент, supercourse.levelExamPassed), плюс профиль по ветвям.
"""

import json
from functools import lru_cache
from pathlib import Path

import chess

DATA = Path(__file__).resolve().parent / "data" / "level_exams.json"
PREFIX = "level"
BRANCHES = ("T", "M", "E", "S", "C")


@lru_cache(maxsize=1)
def levels() -> dict[str, dict]:
    with DATA.open(encoding="utf-8") as handle:
        return {f"{PREFIX}{item['level']}": item for item in json.load(handle)}


def sections() -> list[str]:
    return list(levels())


def is_level_section(section: str) -> bool:
    return section in levels()


def questions(section: str) -> list[dict]:
    return [{"id": index, "fen": q["fen"], "color": "white" if chess.Board(q["fen"]).turn else "black",
             "previous_move": q["previous_move"], "branch": q["branch"]}
            for index, q in enumerate(levels()[section]["questions"], 1)]


def question(section: str, question_id: int) -> dict | None:
    items = levels()[section]["questions"]
    return items[question_id - 1] if 1 <= question_id <= len(items) else None


def is_correct(item: dict, uci: str) -> bool:
    board = chess.Board(item["fen"])
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return False
    if move not in board.legal_moves:
        return False
    if uci == item["answer"]:
        return True
    board.push(move)
    return board.is_checkmate()


def branch_profile(review: list[dict]) -> dict[str, dict]:
    """Верно / всего по ветвям — для итога и карты навыков."""
    profile: dict[str, dict] = {}
    for row in review:
        entry = profile.setdefault(row["branch"], {"correct": 0, "total": 0})
        entry["total"] += 1
        entry["correct"] += int(row["correct"])
    return profile
