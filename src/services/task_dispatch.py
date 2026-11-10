# --- FILE: src/services/task_dispatch.py ---
"""
Постановка фоновых задач Celery из async-кода.

apply_async/delay — синхронный сетевой вызов к брокеру. Сделанный прямо в event loop, он при
медленном или недоступном брокере подвешивал весь воркер: ходы, часы и все WebSocket стояли,
пока kombu пытался подключиться (около 4 с на каждую завершённую партию).

Здесь публикация:
* идёт в потоке (asyncio.to_thread) и не ждётся вызывающим — итог партии рассылается сразу;
* без повторов публикации и с коротким таймаутом соединения (см. celery_app), чтобы поток
  не висел долго;
* после сбоя брокера на CELERY_BROKER_COOLDOWN_S пропускается: иначе каждая завершённая
  партия порождала бы ещё один зависший поток. Анализ партии необязателен — его всё равно
  можно посчитать по запросу на странице партии.
"""

import asyncio
import logging
import time

from src.core.config import settings
from src.worker.tasks import analyze_game_task

logger = logging.getLogger(__name__)

_broker_down_until = 0.0
_background_tasks: set[asyncio.Task] = set()


def _publish_analysis(game_id: int) -> None:
    analyze_game_task.apply_async(args=(game_id,), retry=False)


async def schedule_game_analysis(game_id: int) -> bool:
    """Ставит фоновый анализ партии в очередь. Возвращает True, если задача опубликована."""
    global _broker_down_until

    if time.monotonic() < _broker_down_until:
        logger.debug("Broker cooldown: skipping analysis task for game %s", game_id)
        return False

    try:
        await asyncio.wait_for(
            asyncio.to_thread(_publish_analysis, game_id),
            timeout=settings.CELERY_PUBLISH_TIMEOUT_S,
        )
        return True
    except Exception as exc:  # включая asyncio.TimeoutError
        _broker_down_until = time.monotonic() + settings.CELERY_BROKER_COOLDOWN_S
        logger.error(
            "Could not schedule analysis task for game %s (%s); skipping publishes for %s s",
            game_id, exc.__class__.__name__, settings.CELERY_BROKER_COOLDOWN_S,
        )
        return False


def schedule_game_analysis_in_background(game_id: int) -> asyncio.Task:
    """Запускает постановку задачи, не дожидаясь её. Ссылка на задачу хранится до завершения."""
    task = asyncio.create_task(schedule_game_analysis(game_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def reset_broker_cooldown() -> None:
    global _broker_down_until
    _broker_down_until = 0.0
