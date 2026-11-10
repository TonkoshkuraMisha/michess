from celery import Celery
from src.core.config import settings

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
)
