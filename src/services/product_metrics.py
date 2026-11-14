# --- FILE: src/services/product_metrics.py ---
"""
Продуктовые метрики без сторонних трекеров (таск 23.5).

События пишутся в свою таблицу product_events (вид, игрок, сутки UTC) — не чаще раза в сутки на вид и игрока.
Отчёт для владельца (scripts/product_metrics.py) считает по ним:
* регистрации по дням;
* активацию — доля новых игроков, сыгравших первую партию за ACTIVATION_FAST_S после регистрации и в первые сутки;
* удержание D1/D7/D30 — доля когорты регистрации, активная ровно через 1, 7 и 30 дней;
* сколько игроков дошли до задач, уроков и турниров.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.models.product_event import ProductEvent

logger = logging.getLogger(__name__)

REGISTERED = "registered"
ACTIVE = "active"
GAME_FINISHED = "game_finished"
PUZZLE_ATTEMPT = "puzzle_attempt"
LESSON_COMPLETED = "lesson_completed"
TOURNAMENT_CREATED = "tournament_created"
EVENT_KINDS = (REGISTERED, ACTIVE, GAME_FINISHED, PUZZLE_ATTEMPT, LESSON_COMPLETED, TOURNAMENT_CREATED)

ACTIVATION_FAST_S = 5 * 60
RETENTION_DAYS = (1, 7, 30)


def utc_today() -> date:
    return datetime.now(UTC).date()


async def record_event(db: AsyncSession, user_id: int | None, kind: str) -> None:
    """
    Отмечает событие в транзакции вызывающего (savepoint: повтор за сутки откатывает только его). Не коммитит —
    событие сохраняется вместе с действием, которое его вызвало. Сбой учёта не ломает действие.
    """
    if user_id is None or kind not in EVENT_KINDS:
        return
    try:
        async with db.begin_nested():
            db.add(ProductEvent(kind=kind, user_id=user_id, day=utc_today()))
    except IntegrityError:
        pass  # уже отмечено сегодня
    except Exception as exc:
        logger.warning("Product event %s for user %s not recorded: %s", kind, user_id, exc)


ACTIVE_MARK_TTL_S = 2 * 86400


async def mark_active(session_factory: async_sessionmaker[AsyncSession], user_id: int) -> None:
    """
    «Игрок был сегодня» — для удержания. Redis пропускает только первую отметку за сутки (без лишних записей в БД);
    запись — в своей короткой сессии: запрос, который ничего не коммитит (GET), её бы потерял.
    """
    from src.db import redis as redis_module

    try:
        first_today = await redis_module.redis_client.set(
            f"product:active:{utc_today().isoformat()}:{user_id}", "1", nx=True, ex=ACTIVE_MARK_TTL_S,
        )
    except Exception:
        first_today = True  # без Redis — пишем: уникальный индекс не даст дублей
    if not first_today:
        return
    try:
        async with session_factory() as db:
            await record_event(db, user_id, ACTIVE)
            await db.commit()
    except Exception as exc:
        logger.warning("Active mark for user %s failed: %s", user_id, exc)


@dataclass
class Cohort:
    day: date
    registered: int = 0
    activated_fast: int = 0
    activated_day: int = 0
    retained: dict[int, int] = field(default_factory=dict)


@dataclass
class Report:
    cohorts: list[Cohort]
    reached: dict[str, int]
    total_users: int


async def build_report(db: AsyncSession, since: date, until: date | None = None) -> Report:
    """Когорты регистрации с since по until (включительно) и сколько игроков когда-либо дошли до разделов."""
    until = until or utc_today()
    rows = (await db.execute(
        select(ProductEvent.user_id, ProductEvent.kind, ProductEvent.day, ProductEvent.created_at)
    )).all()
    registered_at: dict[int, datetime] = {}
    first_game: dict[int, datetime] = {}
    active_days: dict[int, set[date]] = {}
    reached: dict[str, set[int]] = {k: set() for k in (GAME_FINISHED, PUZZLE_ATTEMPT, LESSON_COMPLETED, TOURNAMENT_CREATED)}
    for user_id, kind, day, created_at in rows:
        created_at = created_at.replace(tzinfo=UTC) if created_at.tzinfo is None else created_at
        if kind == REGISTERED:
            registered_at[user_id] = created_at
        elif kind == ACTIVE:
            active_days.setdefault(user_id, set()).add(day)
        if kind in reached:
            reached[kind].add(user_id)
        if kind == GAME_FINISHED and (user_id not in first_game or created_at < first_game[user_id]):
            first_game[user_id] = created_at
        if kind != REGISTERED:
            active_days.setdefault(user_id, set()).add(day)  # любое действие — активный день

    cohorts: dict[date, Cohort] = {}
    day = since
    while day <= until:
        cohorts[day] = Cohort(day, retained={n: 0 for n in RETENTION_DAYS})
        day += timedelta(days=1)
    for user_id, at in registered_at.items():
        cohort = cohorts.get(at.date())
        if cohort is None:
            continue
        cohort.registered += 1
        game = first_game.get(user_id)
        if game is not None:
            delay = (game - at).total_seconds()
            cohort.activated_fast += delay <= ACTIVATION_FAST_S
            cohort.activated_day += delay <= 86400
        days = active_days.get(user_id, set())
        for n in RETENTION_DAYS:
            cohort.retained[n] += (at.date() + timedelta(days=n)) in days
    return Report(
        cohorts=list(cohorts.values()),
        reached={kind: len(users) for kind, users in reached.items()},
        total_users=len(registered_at),
    )
