"""
Экзамены уровней Большого курса (таск 27.12): «тест на разряд». На каждый уровень 0–5 — фиксированный набор позиций по
ветвям курса (тактика T, мат и атака M, эндшпиль E, стратегия S, расчёт C) из src/services/data/level_exams.json
(собирает scripts/build_level_exams.py: задачи базы CC0 около порога разряда, ответ проверен движком — единственный).
Тест идёт через тот же протокол, что диагностика 22.0 (/exam/level<n>/questions, /move и /submit): вопрос — id по
порядку в наборе, решение (поле moves, если оно длиннее одного хода) доигрывается до конца, любой мат засчитывается.
Итог — оценка силы по формуле Эло (src/services/exam.estimate), уровень пройден, когда она не ниже порога
(клиент, supercourse.levelExamPassed), плюс профиль по ветвям.
"""

import json
from functools import lru_cache
from pathlib import Path

import chess

DATA = Path(__file__).resolve().parent / "data" / "level_exams.json"
# Начало кода раздела экзамена уровня: level0 … level5.
PREFIX = "level"
# Ветви курса, по которым размечены вопросы: тактика, мат и атака, эндшпиль, стратегия, расчёт.
BRANCHES = ("T", "M", "E", "S", "C")


@lru_cache(maxsize=1)
def levels() -> dict[str, dict]:
    """Наборы вопросов из файла данных: код раздела («level3») → запись уровня. Файл читается один раз на процесс."""
    with DATA.open(encoding="utf-8") as handle:
        return {f"{PREFIX}{item['level']}": item for item in json.load(handle)}


def sections() -> list[str]:
    return list(levels())


def is_level_section(section: str) -> bool:
    return section in levels()


def questions(section: str) -> list[dict]:
    """Вопросы уровня для клиента — без ответов; id вопроса — его порядковый номер в наборе, начиная с 1."""
    return [{"id": index, "fen": q["fen"], "color": "white" if chess.Board(q["fen"]).turn else "black",
             "previous_move": q["previous_move"], "branch": q["branch"]}
            for index, q in enumerate(levels()[section]["questions"], 1)]


def question(section: str, question_id: int) -> dict | None:
    """Полная запись вопроса (с ответом) по номеру в наборе; номера вне набора — None."""
    items = levels()[section]["questions"]
    return items[question_id - 1] if 1 <= question_id <= len(items) else None


def progress(item: dict, played: list[str]):
    """Сверка ходов игрока с решением вопроса (src/services/exam.play); без поля moves решение — один ход."""
    from src.services.exam import play

    return play(chess.Board(item["fen"]), item.get("moves") or [item["answer"]], played)


def is_correct(item: dict, uci: str) -> bool:
    return progress(item, [uci]).correct > 0


def branch_profile(review: list[dict]) -> dict[str, dict]:
    """Верно / всего по ветвям — для итога и карты навыков."""
    profile: dict[str, dict] = {}
    for row in review:
        entry = profile.setdefault(row["branch"], {"correct": 0, "total": 0})
        entry["total"] += 1
        entry["correct"] += int(row["correct"])
    return profile
