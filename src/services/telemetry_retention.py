# --- FILE: src/services/telemetry_retention.py ---
"""
Хранение телеметрии ходов (задача 9 плана владельца 18.11, таск 29.2): таблица moves — только буфер для античита
(время хода, потеря фокуса окна, предход, задержка сети; src/services/anticheat.py). Ходы самой партии лежат в PGN,
разбор — в games.analysis_json, поэтому сырые строки moves нужны, пока партию могут пересмотреть: RETENTION_DAYS —
срок апелляции на решение по честной игре.

Плановая задача (src/worker/tasks.py → archive_move_telemetry, расписание — beat_schedule в celery_app.py) раз в
сутки берёт законченные раньше срока партии, у которых ещё есть строки moves: дописывает сводку
games.telemetry_summary, если античит её не записал (например, товарищеская партия — её он не оценивает), и удаляет
строки. Пачками по BATCH партий с commit после каждой: прерванный запуск продолжится со следующего.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.move import Move
from src.services.anticheat import telemetry_summary

# Сколько дней сырые ходы партии хранятся после её окончания — срок апелляции на решение по честной игре.
RETENTION_DAYS = 90
# Партий за одну транзакцию.
BATCH = 200


def cutoff(now: datetime | None = None) -> datetime:
    """Партии, законченные раньше этого момента, своих сырых ходов больше не хранят."""
    return (now or datetime.now(UTC)) - timedelta(days=RETENTION_DAYS)


async def archive_old_moves(db: AsyncSession, now: datetime | None = None) -> int:
    """Сводка + удаление ходов для партий старше срока; возвращает число обработанных партий."""
    limit = cutoff(now)
    done = 0
    while True:
        games = list((await db.execute(
            select(Game).where(Game.finished_at.is_not(None), Game.finished_at < limit,
                               exists().where(Move.game_id == Game.id))
            .order_by(Game.id).limit(BATCH)
        )).scalars())
        if not games:
            return done
        ids = [game.id for game in games]
        moves = list((await db.execute(select(Move).where(Move.game_id.in_(ids)).order_by(Move.id))).scalars())
        for game in games:
            if game.telemetry_summary is None:
                game.telemetry_summary = telemetry_summary(game, [m for m in moves if m.game_id == game.id])
        await db.execute(delete(Move).where(Move.game_id.in_(ids)))
        await db.commit()
        done += len(games)
