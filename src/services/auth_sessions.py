# --- FILE: src/services/auth_sessions.py ---
"""
Сессии входа (таск 17.5): короткий access-токен в памяти клиента + долгий refresh-токен в httpOnly-cookie.

Раньше JWT жил сутки в localStorage — любой внедрённый на страницу скрипт (XSS) мог его унести. Теперь:
* access-токен (JWT, ACCESS_TOKEN_EXPIRE_MINUTES) клиент держит только в памяти и шлёт в Authorization, как прежде;
* refresh-токен — случайная строка в cookie HttpOnly + SameSite=Strict, путь /api/v1/auth: скрипт страницы её не
  видит, на чужие сайты и на остальные запросы API она не уходит. В Redis — только её хэш: refresh:<sha256> →
  «<user_id>:<token_version>», срок REFRESH_TOKEN_EXPIRE_DAYS, продлевается при каждом обновлении.
* Отзыв: выход удаляет запись; «выйти везде», смена пароля и удаление аккаунта увеличивают token_version — все
  refresh-токены с прежней версией перестают действовать. Версию из записи с users.token_version сверяет маршрут
  обновления (src/api/auth.py); этот модуль только хранит и читает запись.

Токен при обновлении не меняется (без ротации): у игрока бывает несколько вкладок, и ротация обрывала бы сессию
в той, что обновилась второй.
"""

import hashlib
import logging
import secrets

from fastapi import Response

from src.core.config import settings
from src.db import redis as redis_module

logger = logging.getLogger(__name__)

# Имя cookie с refresh-токеном и начало ключа Redis, под которым хранится запись сессии.
# Имя куки не меняли при переименовании платформы в Regence (18.11.2026): смена разлогинила бы всех игроков.
REFRESH_COOKIE = "michess_refresh"
REFRESH_PREFIX = "refresh:"


def _key(token: str) -> str:
    """Ключ Redis для токена: в ключе — sha256 токена, так что по содержимому Redis сам токен не восстановить."""
    return REFRESH_PREFIX + hashlib.sha256(token.encode()).hexdigest()


def _ttl_s() -> int:
    return settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400


def cookie_secure() -> bool:
    """Secure по умолчанию в продакшене; браузеры принимают такие cookie и на http://localhost."""
    return settings.is_production if settings.COOKIE_SECURE is None else settings.COOKIE_SECURE


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE, token, max_age=_ttl_s(), httponly=True, secure=cookie_secure(), samesite="strict",
        path=f"{settings.API_V1_STR}/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE, httponly=True, secure=cookie_secure(), samesite="strict", path=f"{settings.API_V1_STR}/auth",
    )


async def issue(user_id: int, token_version: int) -> str:
    """Новая сессия входа: случайный refresh-токен и запись о нём в Redis на REFRESH_TOKEN_EXPIRE_DAYS дней."""
    token = secrets.token_urlsafe(32)
    await redis_module.redis_client.set(_key(token), f"{user_id}:{token_version}", ex=_ttl_s())
    return token


async def lookup(token: str | None) -> tuple[int, int] | None:
    """
    (user_id, token_version) по refresh-токену и продление его срока; None — токена нет или он отозван. Недоступный
    Redis — тоже None: игроку придётся войти заново.
    """
    if not token:
        return None
    try:
        value = await redis_module.redis_client.get(_key(token))
        if value is None:
            return None
        await redis_module.redis_client.expire(_key(token), _ttl_s())
    except Exception as exc:
        logger.warning("Refresh session lookup failed: %s", exc)
        return None
    user_id, _, version = str(value).partition(":")
    if not user_id.isdigit() or not version.lstrip("-").isdigit():
        return None
    return int(user_id), int(version)


async def revoke(token: str | None) -> None:
    """Выход: удаляет запись сессии этого токена. Сбой Redis только пишется в лог — запись истечёт сама по сроку."""
    if not token:
        return
    try:
        await redis_module.redis_client.delete(_key(token))
    except Exception as exc:
        logger.warning("Refresh session revoke failed: %s", exc)
