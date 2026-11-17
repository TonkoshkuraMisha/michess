"""
Клиент Redis — общий для API и сервисов (redis_client).

Адрес — настройки REDIS_HOST и REDIS_PORT. Таймауты короткие, повторов мало (REDIS_CONNECT_TIMEOUT_S,
REDIS_SOCKET_TIMEOUT_S, REDIS_RETRIES): при недоступном Redis вызов должен быстро вернуть ошибку, а не держать
вход, ходы и WebSocket по пятнадцать секунд. Что именно хранится в Redis — docs/ARCHITECTURE.md, раздел 3.
"""

from typing import Any

import redis.asyncio as redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from src.core.config import settings


def create_redis_client(**overrides: Any) -> redis.Redis:
    """
    Клиент Redis с короткими таймаутами и ограниченными повторами.

    redis-py 8 по умолчанию повторяет команду 10 раз с растущей паузой: при недоступном Redis
    каждый вызов висел ~15 с, и вход, ходы и WebSocket зависали вместо быстрого fail-open.
    Один немедленный повтор переживает разорванное соединение после рестарта Redis.
    """
    options: dict[str, Any] = {
        "host": settings.REDIS_HOST,
        "port": settings.REDIS_PORT,
        "decode_responses": True,
        "socket_connect_timeout": settings.REDIS_CONNECT_TIMEOUT_S,
        "socket_timeout": settings.REDIS_SOCKET_TIMEOUT_S,
        "retry": Retry(NoBackoff(), settings.REDIS_RETRIES),
    }
    options.update(overrides)
    return redis.Redis(**options)


# Глобальный асинхронный клиент Redis.
# Тип Any сознательно: с decode_responses=True все ответы — str, но заглушки типов redis-py
# этого не выражают и описывают каждый ответ как bytes | str. Без Any mypy требовал бы
# декодировать то, что уже декодировано, в каждом месте использования.
redis_client: Any = create_redis_client()
