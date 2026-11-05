# --- FILE: src/worker/tasks.py ---

import asyncio
import logging
from celery import shared_task

from src.db.session import AsyncSessionLocal
from src.services.anticheat import evaluate_game_telemetry

logger = logging.getLogger(__name__)


async def _process_anti_cheat_async(game_id: int) -> dict:
    async with AsyncSessionLocal() as db:
        return await evaluate_game_telemetry(db, game_id)


@shared_task(name="analyze_game")
def analyze_game_task(game_id: int):
    """Синхронная обёртка Celery для запуска асинхронного анализатора телеметрии."""
    try:
        return asyncio.run(_process_anti_cheat_async(game_id))
    except Exception as exc:
        logger.error("Anti-cheat task failed for game %s: %s", game_id, exc)
        return {"game_id": game_id, "status": "error"}
