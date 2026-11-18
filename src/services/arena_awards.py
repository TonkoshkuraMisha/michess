# --- FILE: src/services/arena_awards.py ---
"""
Награды арен (таск 33.5, задача 10 плана владельца 18.11). Когда итоги арены или швейцарки окончательные
(arena.status == "finished": время вышло и доиграны все партии; у швейцарки — сыгран последний тур), тройка таблицы
итогов (arena.ranked) получает призовые места — таблица arena_awards, уведомление «arena_podium» каждому призёру.
Место получает только тот, кто сыграл хотя бы одну партию. Каждое деление арены — своя таблица и свои призёры.

Из записей arena_awards считаются кубки в профиле (trophies: золото, серебро, бронза) и достижения «призёр арены» и
«победитель арены» (src/services/achievements.py). Раздаёт награды плановая задача arena_awards
(src/worker/tasks.py, расписание — beat_schedule в celery_app.py); арену проверяют, пока не прошло LOOKBACK после
объявленного конца, и награждают один раз (у арены уже есть записи — пропускается). place_of — место игрока из
этих же записей: по нему страница арены показывает праздник призёра.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.arena import Arena, ArenaAward
from src.services import arena as arena_service
from src.services import notifications
from src.services.rating import classify_time_control

# Сколько мест награждается.
PODIUM = 3
# Сколько после объявленного конца арену ещё проверяют: недоигранная партия могла задержать итоги.
LOOKBACK = timedelta(days=3)
# Названия мест для кубков профиля по номеру места.
MEDALS = {"1": "gold", "2": "silver", "3": "bronze"}


async def award_finished(db: AsyncSession, now: datetime | None = None) -> int:
    """Награждает все арены с окончательными итогами, ещё не награждённые; возвращает число новых наград (с commit)."""
    now = now or datetime.now(UTC)
    candidates = (await db.execute(select(Arena).where(
        or_(Arena.ends_at <= now, Arena.finished_at.is_not(None)),
        Arena.ends_at > now - LOOKBACK,
        Arena.format != "match",  # матч конференций — командный: кубки за личное место в нём не даются
        ~exists().where(ArenaAward.arena_id == Arena.id),
    ).order_by(Arena.id))).scalars().all()
    added = 0
    for arena in candidates:
        open_games = await arena_service.open_games(db, arena.id)
        if arena_service.status(arena, now, open_games) != "finished":
            continue
        category = classify_time_control(arena.base_time_ms, arena.increment_ms)
        winners = [p for p, _, _ in await arena_service.ranked(db, arena.id) if p.games > 0][:PODIUM]
        for place, player in enumerate(winners, 1):
            db.add(ArenaAward(arena_id=arena.id, place=str(place), user_id=player.user_id, category=category))
            await notifications.record(db, player.user_id, "arena_podium",
                                       {"arena_id": arena.id, "place": place, "category": category}, commit=False)
            added += 1
    await db.commit()
    return added


async def trophies(db: AsyncSession, user_id: int) -> dict[str, int]:
    """Кубки игрока: {gold, silver, bronze} — число первых, вторых и третьих мест в аренах."""
    rows = (await db.execute(select(ArenaAward.place, func.count()).where(ArenaAward.user_id == user_id)
                             .group_by(ArenaAward.place))).all()
    counts = {medal: 0 for medal in MEDALS.values()}
    for place, count in rows:
        counts[MEDALS[place]] = count
    return counts


async def place_of(db: AsyncSession, arena_id: int, user_id: int) -> int | None:
    """Призовое место игрока в арене (1–3) из arena_awards; None — не призёр или итоги ещё не подведены."""
    place = await db.scalar(select(ArenaAward.place).where(ArenaAward.arena_id == arena_id,
                                                          ArenaAward.user_id == user_id))
    return int(place) if place is not None else None
