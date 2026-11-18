# --- FILE: src/services/coach_cards.py ---
"""
«Клубный тренер» после партии (задача 5 плана владельца, 18.11): до трёх карточек действия в один клик в итоге
партии (frontend GameSummaryPanel). Сервис только собирает уже готовое — движок не вызывается:

* «Исправь свой зевок» — личная задача из этой партии (personal_puzzles: их создаёт фоновый разбор, src/worker/
  tasks.py) с самой большой потерей хода (personal_puzzles.cp_loss); решение не отдаётся, ответ — обычный
  POST /puzzles/personal/{id}/answer;
* «Дебютное отклонение» — где партия ушла из репертуара игрока (repertoire_deviations.for_game), правило выбора —
  pick_deviation;
* «Урок по теме ошибки» — темы самой дорогой ошибки (темы той же личной задачи) в порядке значимости; какой модуль
  Большого курса их проходит, решает клиент: курс — его данные (frontend/src/content/supercourse.ts).

analysed — разбор партии готов (games.analysis_json). Личные задачи появляются через несколько секунд после разбора
(та же фоновая задача), поэтому клиент при analysed и пустой задаче спрашивает ещё раз (POLL в GameSummaryPanel).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.puzzle import PersonalPuzzle
from src.services import personal_puzzles, repertoire_deviations

# Отклонения, по которым есть что делать, в порядке важности: свой ход не по репертуару — ошибка памяти; новый ход
# соперника — пробел в подготовке. «Линия кончилась» и «прошли целиком» карточки не дают.
ACTIONABLE_DEVIATIONS = ("you_left", "opponent_new")


def pick_deviation(results: list[dict]) -> dict | None:
    """
    Одно отклонение для карточки из результатов for_game: сначала вид по ACTIONABLE_DEVIATIONS, внутри вида — самое
    раннее в партии (раньше ушли из подготовки — важнее). None — действовать не по чему.
    """
    actionable = [r for r in results if r["kind"] in ACTIONABLE_DEVIATIONS]
    if not actionable:
        return None
    return min(actionable, key=lambda r: (ACTIONABLE_DEVIATIONS.index(r["kind"]), r["ply"]))


async def costliest_puzzle(db: AsyncSession, game_id: int, user_id: int) -> PersonalPuzzle | None:
    """Личная задача игрока из этой партии с самой большой потерей хода; при равной потере — более ранняя."""
    return await db.scalar(
        select(PersonalPuzzle).where(PersonalPuzzle.game_id == game_id, PersonalPuzzle.user_id == user_id)
        .order_by(PersonalPuzzle.cp_loss.desc(), PersonalPuzzle.ply).limit(1)
    )


async def for_game(db: AsyncSession, game: Game, user_id: int) -> dict:
    """
    Карточки игрока по его законченной партии (проверку «своя и законченная» делает маршрут):
    {game_id, analysed, puzzle (personal_puzzles.view) | None, deviation | None, lesson_themes: [коды тем]}.
    """
    puzzle = await costliest_puzzle(db, game.id, user_id)
    deviation = pick_deviation((await repertoire_deviations.for_game(db, game, user_id))["results"])
    return {
        "game_id": game.id,
        "analysed": game.analysis_json is not None,
        "puzzle": personal_puzzles.view(puzzle) if puzzle is not None else None,
        "deviation": deviation,
        "lesson_themes": personal_puzzles.split_themes(puzzle.themes) if puzzle is not None else [],
    }
