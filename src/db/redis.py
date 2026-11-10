from typing import Any

import redis.asyncio as redis

from src.core.config import settings

# Глобальный асинхронный клиент Redis.
# Тип Any сознательно: с decode_responses=True все ответы — str, но заглушки типов redis-py
# этого не выражают и описывают каждый ответ как bytes | str. Без Any mypy требовал бы
# декодировать то, что уже декодировано, в каждом месте использования.
redis_client: Any = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    decode_responses=True
)
