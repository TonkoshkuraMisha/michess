# --- FILE: src/api/rate_limit.py ---
"""
Ограничение частоты запросов к эндпоинтам, нагружающим Stockfish.

Фиксированное окно в Redis (INCR + EXPIRE). Квота считается на пользователя, если запрос
пришёл с валидным Bearer-токеном, иначе — на IP-адрес (гостевые партии с ботами и просмотр
анализа доступны без входа). Токен только декодируется, без обращения к БД.
"""

import logging
import time

import jwt
from fastapi import HTTPException, Request, status

from src.core.config import settings
from src.db import redis as redis_module

logger = logging.getLogger(__name__)


def _client_identity(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() == "bearer" and token:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            subject = payload.get("sub")
            if subject:
                return f"user:{subject}"
        except jwt.InvalidTokenError:
            pass
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


def rate_limit(scope: str, limit_setting: str):
    """
    Фабрика зависимости FastAPI. limit_setting — имя поля Settings с лимитом на окно,
    читается при каждом запросе (удобно переопределять в тестах и через .env).
    """

    async def _dependency(request: Request) -> None:
        limit = int(getattr(settings, limit_setting))
        window_s = int(settings.RATE_LIMIT_WINDOW_S)
        if limit <= 0:
            return

        window_id = int(time.time()) // window_s
        key = f"ratelimit:{scope}:{_client_identity(request)}:{window_id}"
        redis_client = redis_module.redis_client
        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, window_s + 1)
        except Exception as exc:
            # Redis недоступен — не блокируем пользователей (fail-open), но фиксируем проблему.
            logger.warning("Rate limiter unavailable for %s: %s", scope, exc)
            return

        if count > limit:
            retry_after = window_s - int(time.time()) % window_s
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много запросов к движку, попробуйте чуть позже",
                headers={"Retry-After": str(max(1, retry_after))},
            )

    return _dependency
