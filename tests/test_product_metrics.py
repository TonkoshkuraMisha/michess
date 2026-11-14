# --- FILE: tests/test_product_metrics.py ---
"""Продуктовые метрики без сторонних трекеров (таск 23.5): события, активация, удержание, отчёт владельца."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select

from scripts.product_metrics import render
from src.db.session import get_session_factory
from src.main import app
from src.models.product_event import ProductEvent
from src.services import product_metrics as pm

DAY0 = date(2026, 11, 1)


async def _count(db, **filters) -> int:
    query = select(func.count()).select_from(ProductEvent)
    for column, value in filters.items():
        query = query.where(getattr(ProductEvent, column) == value)
    return await db.scalar(query)


async def test_event_is_recorded_once_per_day_and_kind(db_session, test_user_1):
    for _ in range(3):
        await pm.record_event(db_session, test_user_1.id, pm.PUZZLE_ATTEMPT)
    await pm.record_event(db_session, test_user_1.id, pm.GAME_FINISHED)
    await pm.record_event(db_session, test_user_1.id, "made_up_kind")  # вне списка — не пишется
    await pm.record_event(db_session, None, pm.GAME_FINISHED)  # гость — не пишется
    await db_session.commit()
    assert await _count(db_session, user_id=test_user_1.id) == 2
    assert await _count(db_session, kind=pm.PUZZLE_ATTEMPT) == 1


async def test_registration_is_an_event(client, db_session):
    assert client.post("/api/v1/auth/register", json={"username": "Newcomer", "password": "secret123"}).status_code == 201
    assert await _count(db_session, kind=pm.REGISTERED) == 1


async def test_active_mark_goes_to_the_database_once_a_day(db_session, test_user_1):
    for _ in range(2):
        await pm.mark_active(app.dependency_overrides[get_session_factory](), test_user_1.id)
    assert await _count(db_session, kind=pm.ACTIVE, user_id=test_user_1.id) == 1


def _event(user_id: int, kind: str, at: datetime) -> ProductEvent:
    return ProductEvent(user_id=user_id, kind=kind, day=at.date(), created_at=at)


async def test_report_counts_activation_and_retention(db_session, test_user_1, test_user_2):
    start = datetime(2026, 11, 1, 10, 0, tzinfo=UTC)
    fast, slow = test_user_1.id, test_user_2.id
    db_session.add_all([
        _event(fast, pm.REGISTERED, start),
        _event(fast, pm.GAME_FINISHED, start + timedelta(minutes=3)),  # первая партия за 3 минуты
        _event(fast, pm.ACTIVE, start + timedelta(days=1)),
        _event(fast, pm.PUZZLE_ATTEMPT, start + timedelta(days=7)),  # любое действие — активный день
        _event(slow, pm.REGISTERED, start + timedelta(hours=1)),
        _event(slow, pm.GAME_FINISHED, start + timedelta(hours=12)),  # в тот же день, но не за 5 минут
    ])
    await db_session.commit()

    report = await pm.build_report(db_session, since=DAY0, until=DAY0 + timedelta(days=40))
    cohort = report.cohorts[0]
    assert (cohort.day, cohort.registered, cohort.activated_fast, cohort.activated_day) == (DAY0, 2, 1, 2)
    assert cohort.retained == {1: 1, 7: 1, 30: 0}
    assert report.reached[pm.GAME_FINISHED] == 2 and report.reached[pm.PUZZLE_ATTEMPT] == 1
    assert report.total_users == 2

    text = render(report)
    assert "2026-11-01" in text and " 50.0%" in text and "100.0%" in text


def test_render_marks_days_that_have_not_come_yet():
    today = pm.utc_today()
    report = pm.Report(cohorts=[pm.Cohort(today, registered=1, retained={n: 0 for n in pm.RETENTION_DAYS})],
                       reached={}, total_users=1)
    row = next(line for line in render(report).splitlines() if line.startswith(today.isoformat()))
    assert row.count("…") == len(pm.RETENTION_DAYS)
