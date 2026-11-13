from celery import Celery

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
    # Две очереди (таск A.4): разбор только что сыгранной партии игрока не ждёт, пока досчитаются до 28 партий
    # турнира ботов. В продакшене их слушают разные воркеры (docker-compose.prod.yml), в разработке — один
    # (start_dev.ps1, -Q analysis,simulation).
    task_default_queue=ANALYSIS_QUEUE,
    task_routes={
        "analyze_game": {"queue": ANALYSIS_QUEUE},
        "simulate_tournament_game": {"queue": SIMULATION_QUEUE},
    },
    # Не брать впрок длинные партии симуляции: иначе один воркер набирает очередь и держит её.
    worker_prefetch_multiplier=1,
)
