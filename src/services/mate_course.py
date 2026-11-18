# --- FILE: src/services/mate_course.py ---
"""
Курс матовых конструкций (таск 14.6): 20 конструкций раздела F каталога в учебном порядке. У каждой — объяснение и два
показа (тексты каталога и /puzzles/demo) и TASKS задач темы нарастающей сложности: задачи темы по рейтингу, взятые
равномерно от самой лёгкой до самой трудной — набор постоянен, пока не меняется база. Итог курса — смешанная проверка:
EXAM_SIZE задач разных конструкций из трудной половины их наборов.

Задачи курса решаются обычным /puzzles/{id}/move, но рейтинг решателя не меняют: их можно проходить повторно.
Попытка при этом записывается в историю (puzzle_attempts), как у обычной задачи.

Данные: таблицы puzzles и puzzle_themes (задачи открытой базы lichess, загружает scripts/import_puzzles.py); своих
таблиц у курса нет. Маршруты — src/api/puzzles.py.
"""

import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.puzzle import Puzzle, PuzzleTheme
from src.models.user import User
from src.services import puzzles as puzzles_service
from src.services.themes import THEMES_BY_CODE

# Коды тем раздела F реестра src/services/themes.py в порядке изучения: от простых матов к именным.
COURSE: tuple[str, ...] = (
    "back_rank_mate", "corridor_mate", "smothered_mate", "arabian_mate", "anastasia_mate", "hook_mate",
    "epaulette_mate", "dovetail_mate", "queen_kiss_mate", "opera_mate", "boden_mate", "double_bishop_mate",
    "legal_mate", "greco_mate", "damiano_mate", "lolli_mate", "pillsbury_mate", "morphy_mate", "blackburne_mate",
    "vukovic_mate",
)
TASKS = 10  # задач в наборе одной конструкции (меньше — если в базе у темы столько нет)
EXAM_SIZE = 10  # задач в итоговой проверке: по одной от конструкции, не больше числа конструкций с задачами
EXAM_MINUTES = 10  # время на проверку; сервер только сообщает его клиенту, отсчёт ведёт клиент

# Защита от опечатки и от переноса темы в другой раздел реестра: модуль не загрузится.
assert all(THEMES_BY_CODE[code].section == "F" for code in COURSE)


async def task_ids(db: AsyncSession, theme: str) -> list[int]:
    """Задачи конструкции от лёгкой к трудной: TASKS штук, равномерно по рейтингу темы."""
    rows = (await db.execute(
        select(Puzzle.id).join(PuzzleTheme).where(PuzzleTheme.theme == theme).order_by(Puzzle.rating, Puzzle.id)
    )).scalars().all()
    if len(rows) <= TASKS:
        return list(rows)
    return [rows[round(i * (len(rows) - 1) / (TASKS - 1))] for i in range(TASKS)]


async def overview(db: AsyncSession) -> dict:
    """Конструкции курса по порядку и сколько задач у каждой (0 — конструкция пока без задач)."""
    return {
        "tasks": TASKS, "exam_size": EXAM_SIZE, "exam_minutes": EXAM_MINUTES,
        "constructions": [{"code": code, "available": len(await task_ids(db, code))} for code in COURSE],
    }


async def start_task(db: AsyncSession, user: User, theme: str, index: int) -> Puzzle:
    """
    Открывает задачу курса матовых конструкций по её номеру в наборе темы. Решается обычным ходом задачи
    (/puzzles/{id}/move), но рейтинг решателя не меняет.
    """
    if theme not in COURSE:
        raise puzzles_service.PuzzleError("unknown_theme", 400, theme=theme)
    ids = await task_ids(db, theme)
    if not 0 <= index < len(ids):
        raise puzzles_service.PuzzleError("no_puzzles_available", 404)
    puzzle = await db.get(Puzzle, ids[index])
    assert puzzle is not None
    await puzzles_service.start(user, puzzle, course=theme)
    return puzzle


async def exam_plan(db: AsyncSession, rng: random.Random | None = None) -> list[dict]:
    """
    Смешанная проверка: задачи разных конструкций (по одной), из трудной половины набора каждой. Конструкции
    выбираются случайно; если задач нет у части из них, проверка короче EXAM_SIZE. Возвращает пары «тема, номер
    задачи в наборе» — саму задачу клиент открывает через ``start_task``.
    """
    rng = rng or random.Random()
    pool = []
    for code in COURSE:
        count = len(await task_ids(db, code))
        if count:
            pool.append((code, count))
    rng.shuffle(pool)
    return [{"theme": code, "index": rng.randrange(count // 2, count)} for code, count in pool[:EXAM_SIZE]]
