"""
Приложение Celery: очереди и расписание фоновых задач. Брокер и хранилище результатов — Redis (базы 0 и 1).

Очередей две, чтобы долгие партии ботов не задерживали разбор партий игроков: analysis (по умолчанию — разбор
партий, индекс позиций, напоминания) и simulation (партии ботов между собой, самоигра). В продакшене их слушают разные воркеры
(docker-compose.prod.yml), в разработке — один. Расписание (beat_schedule) исполняет отдельный процесс celery beat —
он должен быть один на всю установку. Сами задачи — src/worker/tasks.py; список с расписанием — DEPLOY.md, 8в.

Публикация задач из API не должна задерживать игру, поэтому таймауты соединения с брокером короткие, а повторов
публикации нет (см. src/services/task_dispatch.py).
"""

from celery import Celery
from celery.schedules import crontab

from src.core.config import settings
from src.core.observability import init_sentry

init_sentry("worker")

ANALYSIS_QUEUE = "analysis"
SIMULATION_QUEUE = "simulation"

celery_app = Celery(
    "michess_worker",
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
    },
    # Не брать впрок длинные партии симуляции: иначе один воркер набирает очередь и держит её.
    worker_prefetch_multiplier=1,
)
