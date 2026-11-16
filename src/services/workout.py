"""
Ежедневная разминка (таск 22.2) — 10–15 минут из уже имеющихся тренировок, без новых таблиц:

1. 5 задач по самым слабым темам (карта навыков 22.1; без данных — базовые темы);
2. 1 тренажёр зрения или счёта (19.x) — тот, что игрок делал реже всего;
3. повторение дебютов по расписанию (20.2), если есть карточки к повторению;
4. 1 «ваша ошибка» (13.5), если есть позиции из своих партий к повторению.

Шаг засчитывается по самим тренировкам за сегодня (UTC), поэтому подделать его нечем. День разминки выполнен, если
решено 5 задач и пройден тренажёр; серия — сколько дней подряд так было (сегодняшний день ещё может быть в работе).
"""

from collections import Counter
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.puzzle import PersonalPuzzle, PuzzleAttempt
from src.models.repertoire import Repertoire, RepertoireCard
from src.models.trainer import TrainerResult
from src.models.user import User
from src.services import skills

PUZZLES = 5
WEAK_THEMES = 3
DEFAULT_THEMES = ("fork", "pin", "back_rank_mate")
TRAINERS = ("coord_find", "coord_name", "blind_where", "calc_checks", "calc_exchange", "calc_square",
            "memory_position", "knight_route")
STREAK_DAYS = 60


def _day(moment: datetime) -> date:
    return (moment if moment.tzinfo else moment.replace(tzinfo=UTC)).astimezone(UTC).date()


async def _days(db: AsyncSession, column, user_column, user_id: int, since: datetime) -> Counter[date]:
    rows = (await db.execute(select(column).where(user_column == user_id, column >= since))).scalars().all()
    return Counter(_day(moment) for moment in rows if moment is not None)


async def streak_status(db: AsyncSession, user_id: int, now: datetime) -> tuple[bool, int]:
    """Выполнена ли разминка сегодня и длина серии (дни подряд, включая сегодня, если выполнена)."""
    today = _day(now)
    start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    since = start - timedelta(days=STREAK_DAYS)
    puzzle_days = await _days(db, PuzzleAttempt.created_at, PuzzleAttempt.user_id, user_id, since)
    trainer_days = await _days(db, TrainerResult.created_at, TrainerResult.user_id, user_id, since)

    def complete(day: date) -> bool:
        return puzzle_days[day] >= PUZZLES and trainer_days[day] >= 1

    streak = 0
    day = today if complete(today) else today - timedelta(days=1)
    while complete(day):
        streak += 1
        day -= timedelta(days=1)
    return complete(today), streak


async def plan(db: AsyncSession, user: User, now: datetime) -> dict:
    today = _day(now)
    start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    since = start - timedelta(days=STREAK_DAYS)
    puzzle_days = await _days(db, PuzzleAttempt.created_at, PuzzleAttempt.user_id, user.id, since)
    trainer_days = await _days(db, TrainerResult.created_at, TrainerResult.user_id, user.id, since)

    _, weakest = await skills.tactics(db, user.id)
    themes = [w["theme"] for w in weakest][:WEAK_THEMES] or list(DEFAULT_THEMES)

    tried = dict((await db.execute(
        select(TrainerResult.trainer, func.count()).where(TrainerResult.user_id == user.id,
                                                          TrainerResult.trainer.in_(TRAINERS))
        .group_by(TrainerResult.trainer)
    )).tuples().all())
    trainer = min(TRAINERS, key=lambda key: (tried.get(key, 0), TRAINERS.index(key)))

    due_rows = (await db.execute(
        select(Repertoire.id, func.count()).join(RepertoireCard, RepertoireCard.repertoire_id == Repertoire.id)
        .where(Repertoire.user_id == user.id, RepertoireCard.due_at.is_not(None), RepertoireCard.due_at <= now)
        .group_by(Repertoire.id)
    )).tuples().all()
    repertoire_due = sum(count for _, count in due_rows)
    repertoire_id = max(due_rows, key=lambda row: row[1])[0] if due_rows else None

    mistakes_due = await db.scalar(select(func.count()).select_from(PersonalPuzzle).where(
        PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(False), PersonalPuzzle.due_at <= now)) or 0

    def complete(day: date) -> bool:
        return puzzle_days[day] >= PUZZLES and trainer_days[day] >= 1

    streak = 0
    day = today if complete(today) else today - timedelta(days=1)
    while complete(day):
        streak += 1
        day -= timedelta(days=1)

    return {
        "date": today.isoformat(),
        "complete": complete(today),
        "streak": streak,
        "steps": [
            {"kind": "puzzles", "themes": themes, "target": PUZZLES, "done": min(puzzle_days[today], PUZZLES)},
            {"kind": "trainer", "trainer": trainer, "done": trainer_days[today] >= 1},
            {"kind": "repertoire", "due": repertoire_due, "repertoire_id": repertoire_id, "done": repertoire_due == 0},
            {"kind": "mistake", "due": mistakes_due, "done": mistakes_due == 0},
        ],
    }


def utcnow() -> datetime:
    return datetime.now(UTC)


async def send_reminders(db: AsyncSession, now: datetime) -> int:
    """
    Напоминание о разминке (плановая задача Celery beat, раз в день): игрокам с идущей серией, которые сегодня ещё
    не размялись; не больше одного напоминания в день. Возвращает число отправленных.
    """
    from src.models.social import Notification
    from src.services import notifications

    today = _day(now)
    start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    recent = start - timedelta(days=1)
    active = set((await db.execute(select(PuzzleAttempt.user_id).where(PuzzleAttempt.created_at >= recent))).scalars())
    active &= set((await db.execute(select(TrainerResult.user_id).where(TrainerResult.created_at >= recent))).scalars())
    reminded = set((await db.execute(select(Notification.user_id).where(
        Notification.kind == "workout_reminder", Notification.created_at >= start))).scalars())
    sent = 0
    for user_id in sorted(active - reminded):
        done, streak = await streak_status(db, user_id, now)
        if done or streak == 0:
            continue
        notification = await notifications.record(db, user_id, "workout_reminder", {"streak": streak})
        await notifications.deliver(user_id, notification)
        sent += 1
    return sent
