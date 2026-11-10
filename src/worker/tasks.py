# --- FILE: src/worker/tasks.py ---

import asyncio
import logging

from celery import shared_task
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.core.config import settings
from src.services.analysis_service import analysis_service
from src.services.engine_pool import EngineBusyError

logger = logging.getLogger(__name__)

ENGINE_BUSY_RETRY_S = 15


def _task_database_url() -> str:
    return settings.async_database_url


async def _prewarm_game_analysis_async(game_id: int) -> dict:
    """
    Выполняет фоновый расчёт и кэширование полного анализа партии после её завершения.

    Каждая задача Celery запускается в собственном event loop (asyncio.run), а соединения
    asyncpg привязаны к loop, в котором созданы. Глобальный движок приложения с пулом
    соединений здесь использовать нельзя: со второй задачи воркер получил бы
    «attached to a different loop». Поэтому на задачу — свой движок без пула, закрываемый в конце.
    """
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            return await analysis_service.analyze_full_game(db, game_id, force=False)
    finally:
        await engine.dispose()


@shared_task(name="analyze_game", bind=True, max_retries=5)
def analyze_game_task(self, game_id: int):
    """Синхронная обёртка Celery для фонового анализа завершённой партии."""
    try:
        return asyncio.run(_prewarm_game_analysis_async(game_id))
    except EngineBusyError as exc:
        # Все движки заняты — анализ не теряем, а откладываем.
        raise self.retry(exc=exc, countdown=ENGINE_BUSY_RETRY_S)
    except Exception:
        logger.exception("Background analysis task failed for game %s", game_id)
        return {"game_id": game_id, "status": "error"}
