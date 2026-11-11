# --- FILE: src/api/rate_limit.py ---
"""
Ограничение частоты запросов: эндпоинты, нагружающие Stockfish, вход и регистрация.

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
    return f"ip:{client_ip(request)}"


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _window(window_s: int) -> tuple[int, int]:
    """(номер текущего окна, секунд до его конца)."""
    now = int(time.time())
    return now // window_s, max(1, window_s - now % window_s)


def _too_many(detail: str, retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(retry_after)},
    )


async def try_consume(scope: str, identity: str, limit: int, window_s: int) -> bool:
    """
    Засчитывает попытку; False, если в текущем окне их уже больше limit.
    limit <= 0 — без ограничения. При недоступном Redis пропускает (fail-open).
    """
    if limit <= 0:
        return True
    window_id, _ = _window(window_s)
    key = f"ratelimit:{scope}:{identity}:{window_id}"
    redis_client = redis_module.redis_client
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, window_s + 1)
    except Exception as exc:
        # Redis недоступен — не блокируем пользователей (fail-open), но фиксируем проблему.
        logger.warning("Rate limiter unavailable for %s: %s", scope, exc)
        return True
    return count <= limit


async def enforce_rate_limit(scope: str, identity: str, limit: int, window_s: int, detail: str) -> None:
    """Как try_consume, но для HTTP: бросает 429 с Retry-After."""
    if not await try_consume(scope, identity, limit, window_s):
        raise _too_many(detail, _window(window_s)[1])


async def ensure_below_limit(scope: str, identity: str, limit: int, window_s: int, detail: str) -> None:
    """Проверяет счётчик, не увеличивая его (например, неудачных входов): 429, если лимит исчерпан."""
    if limit <= 0:
        return
    window_id, retry_after = _window(window_s)
    try:
        count = int(await redis_module.redis_client.get(f"ratelimit:{scope}:{identity}:{window_id}") or 0)
    except Exception as exc:
        logger.warning("Rate limiter unavailable for %s: %s", scope, exc)
        return
    if count >= limit:
        raise _too_many(detail, retry_after)


async def record_attempt(scope: str, identity: str, window_s: int) -> None:
    """Увеличивает счётчик без проверки (парный к ensure_below_limit)."""
    window_id, _ = _window(window_s)
    key = f"ratelimit:{scope}:{identity}:{window_id}"
    try:
        if await redis_module.redis_client.incr(key) == 1:
            await redis_module.redis_client.expire(key, window_s + 1)
    except Exception as exc:
        logger.warning("Rate limiter unavailable for %s: %s", scope, exc)


def rate_limit(scope: str, limit_setting: str, guest_limit_setting: str | None = None):
    """
    Фабрика зависимости FastAPI для эндпоинтов движка. limit_setting — имя поля Settings
    с лимитом на окно, читается при каждом запросе (удобно переопределять в тестах и через .env).
    guest_limit_setting — отдельный (более жёсткий) лимит для запросов без токена.
    """

    async def _dependency(request: Request) -> None:
        identity = _client_identity(request)
        setting = guest_limit_setting if guest_limit_setting and identity.startswith("ip:") else limit_setting
        await enforce_rate_limit(
            scope,
            identity,
            int(getattr(settings, setting)),
            int(settings.RATE_LIMIT_WINDOW_S),
            "Слишком много запросов к движку, попробуйте чуть позже",
        )

    return _dependency
