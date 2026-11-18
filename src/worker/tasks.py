# --- FILE: src/worker/tasks.py ---
"""
Фоновые задачи Celery.

* analyze_game — разбор только что законченной партии движком (результат — в games.analysis_json), личные задачи
  из ошибок игроков (src/services/personal_puzzles.py) и раскладка партии в индекс позиций
  (src/services/position_index.py). analyze_imported_game — разбор и задачи для партии с другого сайта.
* simulate_tournament_game — партия ботов между собой в турнире; после неё в очередь ставятся следующие партии.
* workout_reminders, arena_reminders, bot_selfplay, archive_move_telemetry — плановые (расписание —
  src/worker/celery_app.py).

Каждая задача запускается в своём цикле событий и создаёт своё подключение к базе (соединения asyncpg привязаны
к циклу, в котором созданы). Задачам с движком нужен свободный процесс Stockfish из пула: если пул занят,
разбор и партия турнира откладываются на ENGINE_BUSY_RETRY_S секунд и повторяются — не больше пяти раз
(max_retries), после чего задача снимается (разбор тогда можно запросить со страницы партии, а партию турнира
заново поставит в очередь открытие страницы турнира). Самоигра при занятом пуле просто пропускает запуск.
Ставит задачи в очередь src/services/task_dispatch.py.
"""

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
    """Адрес базы для задач. Отдельная функция — чтобы тесты могли подставить адрес своей базы."""
    return settings.async_database_url


async def _prewarm_game_analysis_async(game_id: int) -> dict:
    """
    Выполняет фоновый расчёт и кэширование полного анализа партии после её завершения: сначала раскладывает партию
    в индекс позиций, затем считает разбор (сохраняется в games.analysis_json; готовый не пересчитывается) и по
    нему — личные задачи из ошибок игроков. Возвращает отчёт разбора.

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
    """
    Задача Celery «analyze_game»: фоновый разбор завершённой партии (с человеком или с ботом). Её ставят
    game_state.finish_game и POST /bots/save-game через src/services/task_dispatch.py. Время движка идёт в метрику
    michess_engine_seconds_total с меткой analysis. Любой другой сбой только записывается в журнал: разбор
    необязателен, его можно запросить со страницы партии.
    """
    try:
        with engine_work("analysis"):
            return asyncio.run(_prewarm_game_analysis_async(game_id))
    except EngineBusyError as exc:
        # Все движки заняты — анализ не теряем, а откладываем: до пяти попыток с паузой ENGINE_BUSY_RETRY_S.
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
    """
    Задача Celery: разбор импортированной партии. При занятом пуле движков откладывается на ENGINE_BUSY_RETRY_S и
    повторяется.
    """
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


async def _arena_reminders_async() -> int:
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            from src.services import arena

            sent = await arena.send_reminders(db)
            await db.commit()
            return sent
    finally:
        await engine.dispose()


@celery_app.task(name="arena_reminders", ignore_result=True)
def arena_reminders() -> int:
    """Напоминания о начале арен (таск 33.4) — по расписанию celery beat, раз в минуту."""
    sent = asyncio.run(_arena_reminders_async())
    if sent:
        logger.info("Arena reminders sent: %s", sent)
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


async def _archive_move_telemetry_async() -> int:
    engine = create_async_engine(_task_database_url(), poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            from src.services import telemetry_retention

            return await telemetry_retention.archive_old_moves(db)
    finally:
        await engine.dispose()


@celery_app.task(name="archive_move_telemetry", ignore_result=True)
def archive_move_telemetry() -> int:
    """
    Сырые ходы moves старше срока апелляции — в сводку партии и удалить (src/services/telemetry_retention.py);
    по расписанию celery beat раз в сутки.
    """
    archived = asyncio.run(_archive_move_telemetry_async())
    if archived:
        logger.info("Move telemetry archived for %s games", archived)
    return archived
