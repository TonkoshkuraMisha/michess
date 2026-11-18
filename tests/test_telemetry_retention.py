# --- FILE: tests/test_telemetry_retention.py ---
"""
Хранение телеметрии ходов (задача 9 плана 18.11, src/services/telemetry_retention.py): ходы партий старше срока
апелляции превращаются в сводку games.telemetry_summary и удаляются, свежие остаются; сводку, записанную античитом,
задача не переписывает; задача стоит в расписании beat. Время зафиксировано (now передаётся явно).
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from src.models.game import Game, GameStatus
from src.models.move import Move
from src.services import anticheat, telemetry_retention
from src.worker.celery_app import celery_app

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


async def _game(db, white, black, days_ago: int, summary: dict | None = None) -> Game:
    """Законченная партия days_ago дней назад с шестью ходами каждой стороны (у белых два предхода)."""
    game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED,
                finished_at=NOW - timedelta(days=days_ago), telemetry_summary=summary)
    db.add(game)
    await db.flush()
    for n in range(12):
        side = white if n % 2 == 0 else black
        db.add(Move(game_id=game.id, player_id=side.id, move_number=n // 2 + 1, notation="e2e4",
                    time_taken_ms=1000 + 300 * n, is_premove=side is white and n < 4, network_lag_ms=40 + n))
    await db.commit()
    return game


async def _moves(db, game_id: int) -> int:
    return await db.scalar(select(func.count()).select_from(Move).where(Move.game_id == game_id))


async def test_old_moves_become_a_summary_and_are_deleted(db_session, test_user_1, test_user_2):
    old = await _game(db_session, test_user_1, test_user_2, telemetry_retention.RETENTION_DAYS + 1)
    kept = await _game(db_session, test_user_1, test_user_2, telemetry_retention.RETENTION_DAYS - 1)
    evaluated = await _game(db_session, test_user_1, test_user_2, telemetry_retention.RETENTION_DAYS + 5,
                            summary={"white": {"penalty": 7}})

    assert await telemetry_retention.archive_old_moves(db_session, NOW) == 2
    await db_session.refresh(old)
    await db_session.refresh(evaluated)
    assert await _moves(db_session, old.id) == 0 and await _moves(db_session, evaluated.id) == 0
    assert await _moves(db_session, kept.id) == 12
    white = old.telemetry_summary["white"]
    assert (white["moves"], white["premoves"], white["max_lag_ms"]) == (6, 2, 50)
    assert {"penalty", "blur_ratio", "timing_cv", "mean_time_ms"} <= set(white)
    assert old.telemetry_summary["black"]["moves"] == 6
    assert evaluated.telemetry_summary == {"white": {"penalty": 7}}  # сводку античита не переписывает
    # Повторный запуск — делать нечего.
    assert await telemetry_retention.archive_old_moves(db_session, NOW) == 0


async def test_anticheat_writes_the_summary_at_once(db_session, test_user_1, test_user_2):
    game = await _game(db_session, test_user_1, test_user_2, days_ago=0)
    await anticheat.evaluate_game_telemetry(db_session, game.id)
    await db_session.refresh(game)
    assert game.telemetry_summary["white"]["moves"] == 6 and game.telemetry_summary["black"]["premoves"] == 0


def test_retention_task_is_scheduled():
    schedule = {entry["task"] for entry in celery_app.conf.beat_schedule.values()}
    assert "archive_move_telemetry" in schedule
    assert celery_app.conf.task_routes["archive_move_telemetry"] == {"queue": "analysis"}
