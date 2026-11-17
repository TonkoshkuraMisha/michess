# --- FILE: src/worker/tasks.py ---

import asyncio
import logging

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.core.config import settings
from src.services import game_import, personal_puzzles, position_index, tournament_simulation
from src.services.analysis_service import analysis_service
from src.services.engine_pool import EngineBusyError, engine_work

# Задача привязана к нашему приложению Celery явно. С @shared_task API-процесс, где celery_app
# никто не импортировал, публиковал через приложение по умолчанию — в amqp://localhost:5672
# вместо брокера Redis, и фоновый анализ до воркера не доходил.
from src.worker.celery_app import celery_app

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
            # Индекс позиций (таск 16.1) не зависит от движка — до анализа: занятый движок его не откладывает.
            try:
                await position_index.index_by_id(db, game_id)
            except Exception:
                await db.rollback()
                logger.exception("Position indexing failed for game %s", game_id)
            report = await analysis_service.analyze_full_game(db, game_id, force=False)
            # Задачи из ошибок игрока (таск 13.5) — по готовому разбору; сбой здесь разбор не отменяет.
            try:
                await personal_puzzles.extract_for_game(db, game_id)
            except EngineBusyError:
                raise
            except Exception:
                logger.exception("Personal puzzles extraction failed for game %s", game_id)
            return report
    finally:
        await engine.dispose()


# ignore_result: результат пишется в БД (Game.analysis_json), а бэкенд результатов при публикации
# подписывается на ответ — при недоступном Redis это ~64 с переподключений, после которых
# бэкенд ломается до перезапуска процесса («The Celery application must be restarted»).
@celery_app.task(name="analyze_game", bind=True, max_retries=5, ignore_result=True)
def analyze_game_task(self, game_id: int):
    """Синхронная обёртка Celery для фонового анализа завершённой партии."""
    try:
        with engine_work("analysis"):
            return asyncio.run(_prewarm_game_analysis_async(game_id))
    except EngineBusyError as exc:
        # Все движки заняты — анализ не теряем, а откладываем.
        raise self.retry(exc=exc, countdown=ENGINE_BUSY_RETRY_S) from exc
    except Exception:
        logger.exception("Background analysis task failed for game %s", game_id)
        return {"game_id": game_id, "status": "error"}


async def _analyze_imported_game_async(imported_id: int) -> int:
    """Разбор партии с другого сайта (таск 24.1) и личные задачи из неё; возвращает число новых задач."""
    from src.models.imported_game import ImportedGame

    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            game = await db.get(ImportedGame, imported_id)
            if game is None:
                return 0
            await game_import.analyze(db, game)
            return await personal_puzzles.extract_for_imported(db, imported_id)
    finally:
        await engine.dispose()


@celery_app.task(name="analyze_imported_game", bind=True, max_retries=5, ignore_result=True)
def analyze_imported_game_task(self, imported_id: int):
    try:
        with engine_work("analysis"):
            return asyncio.run(_analyze_imported_game_async(imported_id))
    except EngineBusyError as exc:
        raise self.retry(exc=exc, countdown=ENGINE_BUSY_RETRY_S) from exc
    except Exception:
        logger.exception("Imported game analysis failed for %s", imported_id)
        return 0


async def _simulate_tournament_game_async(tournament_game_id: int) -> list[int]:
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            return await tournament_simulation.simulate(db, tournament_game_id)
    finally:
        await engine.dispose()


@celery_app.task(name="simulate_tournament_game", bind=True, max_retries=5, ignore_result=True)
def simulate_tournament_game_task(self, tournament_game_id: int):
    """Партия ботов между собой в турнире (таск 15.2); следующие партии тура ставятся в очередь здесь же."""
    try:
        with engine_work("simulation"):
            follow_up = asyncio.run(_simulate_tournament_game_async(tournament_game_id))
    except EngineBusyError as exc:
        raise self.retry(exc=exc, countdown=ENGINE_BUSY_RETRY_S) from exc
    except Exception:
        logger.exception("Tournament game simulation failed for %s", tournament_game_id)
        return
    for game_id in follow_up:
        simulate_tournament_game_task.apply_async(args=(game_id,), retry=False)


async def _workout_reminders_async() -> int:
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            from src.services import workout

            return await workout.send_reminders(db, workout.utcnow())
    finally:
        await engine.dispose()


@celery_app.task(name="workout_reminders", ignore_result=True)
def workout_reminders() -> int:
    """Напоминания о разминке (таск 22.2) — по расписанию celery beat."""
    sent = asyncio.run(_workout_reminders_async())
    logger.info("Workout reminders sent: %s", sent)
    return sent

async def _bot_selfplay_async() -> int:
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            from src.services.bots import selfplay

            return await selfplay.run(db)
    finally:
        await engine.dispose()


@celery_app.task(name="bot_selfplay", ignore_result=True)
def bot_selfplay() -> int:
    """Самоигра архетипов (таск 32.3) — по расписанию celery beat, в очереди simulation (работа процессора)."""
    try:
        with engine_work("simulation"):
            played = asyncio.run(_bot_selfplay_async())
    except EngineBusyError:
        logger.info("Bot self-play skipped: the engine pool is busy")
        return 0
    logger.info("Bot self-play games: %s", played)
    return played
