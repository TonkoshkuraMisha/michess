"""
Приложение Celery: очереди и расписание фоновых задач. Брокер и хранилище результатов — Redis (базы 0 и 1).

Очередей две, чтобы долгие партии ботов не задерживали разбор партий игроков: analysis (по умолчанию — разбор
партий, индекс позиций, напоминания) и simulation (партии ботов между собой, самоигра). В продакшене их слушают разные воркеры
(docker-compose.prod.yml), в разработке — один. Расписание (beat_schedule) исполняет отдельный процесс celery beat —
он должен быть один на всю установку. Сами задачи — src/worker/tasks.py; список с расписанием — DEPLOY.md, 8в.

Публикация задач из API не должна задерживать игру, поэтому таймауты соединения с брокером короткие, а повторов
публикации нет (см. src/services/task_dispatch.py).

Метрики Prometheus воркера (время движка в разборе и симуляциях) отдаёт главный процесс на WORKER_METRICS_PORT —
сигналы ниже, правила — src/core/observability.start_worker_metrics_server.
"""

import logging

from celery import Celery
from celery.schedules import crontab
from celery.signals import setup_logging, task_failure, task_postrun, task_prerun, worker_init, worker_process_shutdown

from src.core.config import settings
from src.core.logging_setup import end_log_context, start_log_context
from src.core.logging_setup import setup_logging as configure_logging
from src.core.observability import forget_worker_process, init_sentry, start_worker_metrics_server

init_sentry("worker")


# Токены контекстов журнала по id задач: prerun открывает контекст, postrun закрывает (src/core/logging_setup.py).
_task_log_tokens: dict[str, object] = {}
_task_logger = logging.getLogger("regence.task")


@setup_logging.connect
def _configure_worker_logging(**_) -> None:
    """Единый формат журнала воркера (json/text, файл) вместо собственной настройки Celery."""
    configure_logging("worker")


@task_prerun.connect
def _bind_task_context(task_id=None, task=None, args=None, **_) -> None:
    """Каждая строка журнала внутри задачи несёт её имя и id; первый числовой аргумент — id партии (game_id)."""
    game_id = args[0] if args and isinstance(args[0], int) else None
    _task_log_tokens[task_id] = start_log_context(task=getattr(task, "name", None), task_id=task_id, game_id=game_id)
    _task_logger.info("task_started")


@task_postrun.connect
def _release_task_context(task_id=None, state=None, **_) -> None:
    """Закрывает контекст задачи; итог (state) пишется строкой task_finished."""
    _task_logger.info("task_finished", extra={"state": state})
    token = _task_log_tokens.pop(task_id, None)
    if token is not None:
        end_log_context(token)  # type: ignore[arg-type]


@task_failure.connect
def _log_task_failure(task_id=None, exception=None, einfo=None, **_) -> None:
    """Сбой задачи — со стеком: без него воркер писал бы только строку Celery без контекста."""
    _task_logger.error("task_failed", exc_info=(type(exception), exception, getattr(einfo, "tb", None)) if exception else None)


@worker_init.connect
def _serve_worker_metrics(**_) -> None:
    """Главный процесс воркера (до запуска дочерних): /metrics на WORKER_METRICS_PORT, если он задан."""
    start_worker_metrics_server(settings.WORKER_METRICS_PORT)


@worker_process_shutdown.connect
def _forget_worker_process(pid: int | None = None, **_) -> None:
    """Дочерний процесс завершается — его «живые» показатели больше не суммируются."""
    if pid:
        forget_worker_process(pid)

ANALYSIS_QUEUE = "analysis"
SIMULATION_QUEUE = "simulation"

celery_app = Celery(
    "regence_worker",
    broker=f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/0",
    backend=f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/1",
    include=["src.worker.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Публикация из API-процесса не должна долго висеть на недоступном брокере
    # (по умолчанию kombu ждёт подключения ~4 с и повторяет попытки).
    broker_connection_timeout=settings.CELERY_BROKER_CONNECT_TIMEOUT_S,
    broker_transport_options={
        "socket_connect_timeout": settings.CELERY_BROKER_CONNECT_TIMEOUT_S,
        "socket_timeout": settings.CELERY_PUBLISH_TIMEOUT_S,
    },
    task_publish_retry=False,
    # Воркер при старте по-прежнему ждёт брокер (это отдельная настройка).
    broker_connection_retry_on_startup=True,
    # Две очереди (таск A.4): разбор только что сыгранной партии игрока не ждёт, пока досчитаются партии ботов
    # в турнире (в круговом на 8 участников — 28 партий, из них 21 боты играют между собой).
    # В продакшене их слушают разные воркеры (docker-compose.prod.yml), в разработке — один
    # (start_dev.ps1, -Q analysis,simulation).
    task_default_queue=ANALYSIS_QUEUE,
    task_routes={
        "analyze_game": {"queue": ANALYSIS_QUEUE},
        "analyze_imported_game": {"queue": ANALYSIS_QUEUE},
        "simulate_tournament_game": {"queue": SIMULATION_QUEUE},
        "workout_reminders": {"queue": ANALYSIS_QUEUE},
        "arena_reminders": {"queue": ANALYSIS_QUEUE},
        "archive_move_telemetry": {"queue": ANALYSIS_QUEUE},
        "arena_awards": {"queue": ANALYSIS_QUEUE},
        "bot_selfplay": {"queue": SIMULATION_QUEUE},
    },
    # Плановые задачи (процесс celery beat, сервис beat в docker-compose.prod.yml; список — DEPLOY.md, раздел 8в).
    # Напоминание о разминке 22.2 — раз в день, в 16:00 UTC: вечер в Европе.
    beat_schedule={
        "workout-reminders": {"task": "workout_reminders", "schedule": crontab(hour=16, minute=0)},
        # Самоигра архетипов (таск 32.3): каждые 6 часов, в минуту 17 — не вместе с другими плановыми задачами.
        "bot-selfplay": {"task": "bot_selfplay", "schedule": crontab(hour="*/6", minute=17)},
        # Напоминания о начале арен (таск 33.4): каждую минуту — уведомление уходит за пять минут до старта
        # (arena.REMIND_BEFORE).
        "arena-reminders": {"task": "arena_reminders", "schedule": crontab()},
        # Хранение телеметрии ходов (задача 9 плана 18.11): раз в сутки ночью по UTC, в минуту 41 — не вместе с другими.
        "archive-move-telemetry": {"task": "archive_move_telemetry", "schedule": crontab(hour=3, minute=41)},
        # Награды арен (таск 33.5): каждые 5 минут — призёры получают места вскоре после окончательных итогов.
        "arena-awards": {"task": "arena_awards", "schedule": crontab(minute="*/5")},
    },
    # Не брать впрок длинные партии симуляции: иначе один воркер набирает очередь и держит её.
    worker_prefetch_multiplier=1,
)
