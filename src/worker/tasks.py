# --- FILE: src/worker/tasks.py ---

import asyncio
import logging
from celery import shared_task

from src.db.session import AsyncSessionLocal
from src.services.analysis_service import analysis_service

logger = logging.getLogger(__name__)


async def _prewarm_game_analysis_async(game_id: int) -> dict:
    """Выполняет фоновый расчёт и кэширование полного анализа партии после её завершения."""
    async with AsyncSessionLocal() as db:
        return await analysis_service.analyze_full_game(db, game_id, force=False)


@shared_task(name="analyze_game")
def analyze_game_task(game_id: int):
    """Синхронная обёртка Celery для фонового анализа завершённой партии."""
    try:
        return asyncio.run(_prewarm_game_analysis_async(game_id))
    except Exception as exc:
        logger.error("Background analysis task failed for game %s: %s", game_id, exc)
        return {"game_id": game_id, "status": "error"}
