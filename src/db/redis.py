import redis.asyncio as redis
from src.core.config import settings

# Глобальный асинхронный клиент Redis.
redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    decode_responses=True
)