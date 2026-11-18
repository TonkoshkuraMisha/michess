# --- FILE: src/services/arena_league.py ---
"""
Месячная лига арен (таск 33.5, docs/research/arenas.md §7): таблица игроков по сумме очков арен сезона в одной
категории контроля времени. На рейтинг не влияет — это только зачёт за месяц.

Правила:

* сезон — календарный месяц UTC (league.season_bounds, как у Кубка конференций); арена относится к сезону, в котором
  началась;
* в лигу идут только арены (format "arena"): у швейцарки другие очки (за партию, без серий «огня»), складывать их
  с очками арен нечестно;
* категория — classify_time_control по контролю арены; вкладки лиги — категории, в которых расписание
  (arena_schedule.DAY_PLAN и WEEK_PLAN) вообще ставит арены, поэтому новая арена расписания сама даёт свою лигу;
* очки игрока — сумма arena_players.score по аренам (каждое деление — своя арена); в таблице — участники хотя бы
  с одной сыгранной партией. Порядок: очки, затем лучшая арена, затем меньше арен (те же очки за меньшее число
  турниров), затем имя.

Откуда данные: таблицы arenas и arena_players; считается при запросе (GET /arenas/league), ничего не хранит.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import get_args

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.arena import Arena, ArenaPlayer
from src.models.user import RatingCategory, User
from src.services.arena_schedule import DAY_PLAN, WEEK_PLAN
from src.services.league import season_bounds
from src.services.rating import classify_time_control

# Формат турнира, очки которого идут в лигу.
LEAGUE_FORMAT = "arena"
# Сколько строк таблицы отдаёт сервер; своя строка игрока приходит отдельно, даже если он ниже.
TABLE_SIZE = 50

# Категории, в которых расписание ставит арены, — в порядке RatingCategory (пуля, блиц, рапид, классика).
_SCHEDULED = {classify_time_control(slot.base_time_ms, slot.increment_ms)
              for slot in [s for _, s in DAY_PLAN] + [s for _, _, s in WEEK_PLAN] if slot.format == LEAGUE_FORMAT}
LEAGUE_CATEGORIES: tuple[RatingCategory, ...] = tuple(c for c in get_args(RatingCategory) if c in _SCHEDULED)


@dataclass(frozen=True)
class Entry:
    """Итог игрока за сезон в одной категории: сумма очков, лучшая арена, число арен с партиями."""
    user_id: int
    username: str
    score: int
    best: int
    arenas: int


def rank(entries: list[Entry]) -> list[dict]:
    """Таблица лиги по правилам модуля: строки {"place", "user_id", "username", "score", "best", "arenas"}."""
    ordered = sorted(entries, key=lambda e: (-e.score, -e.best, e.arenas, e.username))
    return [{"place": index + 1, "user_id": e.user_id, "username": e.username, "score": e.score, "best": e.best,
             "arenas": e.arenas} for index, e in enumerate(ordered)]


async def league(db: AsyncSession, category: RatingCategory, season: str | None = None,
                 user_id: int | None = None, now: datetime | None = None) -> dict:
    """
    Лига сезона в категории: {"season", "category", "categories", "players", "table" (первые TABLE_SIZE), "me"} —
    me: строка вошедшего игрока (None — без входа или без партий в этом сезоне). season по умолчанию — текущий.
    """
    key, start, end = season_bounds(season, now)
    arenas = (await db.execute(select(Arena.id, Arena.base_time_ms, Arena.increment_ms).where(
        Arena.format == LEAGUE_FORMAT, Arena.starts_at >= start, Arena.starts_at < end))).all()
    ids = [arena_id for arena_id, base, inc in arenas if classify_time_control(base, inc) == category]
    entries: list[Entry] = []
    if ids:
        rows = (await db.execute(
            select(ArenaPlayer.user_id, User.username, func.sum(ArenaPlayer.score), func.max(ArenaPlayer.score),
                   func.count(ArenaPlayer.id))
            .join(User, User.id == ArenaPlayer.user_id)
            .where(ArenaPlayer.arena_id.in_(ids), ArenaPlayer.games > 0)
            .group_by(ArenaPlayer.user_id, User.username)
        )).all()
        entries = [Entry(uid, name, int(score), int(best), int(count)) for uid, name, score, best, count in rows]
    table = rank(entries)
    me = next((row for row in table if row["user_id"] == user_id), None) if user_id is not None else None
    return {"season": key, "category": category, "categories": list(LEAGUE_CATEGORIES), "players": len(table),
            "table": table[:TABLE_SIZE], "me": me}
