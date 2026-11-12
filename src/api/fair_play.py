# --- FILE: src/api/fair_play.py ---
"""
Честная игра: подсказки движка недоступны, пока у игрока идёт рейтинговая партия с человеком.

Зависимость `forbid_engine_help_during_game` подключается ко всем эндпоинтам, которые отдают
оценку позиции или ход движка (анализ позиции, ход бота, в будущем — совет наставника и
дебютный справочник). Проверка идёт на сервере: скрыть кнопку в интерфейсе недостаточно,
эндпоинт можно вызвать напрямую.

Что проверяется:
* запрос с токеном игрока, у которого идёт партия, — отказ (409);
* запрос без токена с адреса, с которого сейчас кто-то играет, — отказ: иначе запрет
  обходился бы простым «не отправлять токен»;
* запрос с другим аккаунтом с того же адреса — разрешён (в одной сети могут быть разные
  люди), но засчитывается игроку как сигнал для античита. Сам по себе он не штрафует.

При недоступном Redis проверка пропускает запрос (fail-open), как и ограничение частоты:
лучше на время потерять защиту, чем отказать в анализе всем.
"""

import logging

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import user_from_token
from src.api.rate_limit import client_ip
from src.core.errors import ApiError
from src.db import redis as redis_module
from src.db.session import get_db

logger = logging.getLogger(__name__)

# Сколько помним, с какого адреса подключался игрок (обновляется при каждом подключении).
PLAYER_IP_TTL_S = 12 * 60 * 60
ENGINE_SIGNAL_TTL_S = 24 * 60 * 60



def _ip_players_key(ip: str) -> str:
    return f"fairplay:ip:{ip}"


def _engine_signal_key(game_id: int, user_id: int) -> str:
    return f"fairplay:engine_requests:{int(game_id)}:{int(user_id)}"


async def remember_player_ip(user_id: int, ip: str | None) -> None:
    """Запоминает адрес, с которого игрок открыл игровое соединение."""
    if not ip or ip == "unknown":
        return
    try:
        key = _ip_players_key(ip)
        await redis_module.redis_client.sadd(key, str(int(user_id)))
        await redis_module.redis_client.expire(key, PLAYER_IP_TTL_S)
    except Exception as exc:
        logger.warning("Could not remember address of user %s: %s", user_id, exc)


async def active_rated_game_id(user_id: int) -> int | None:
    """
    id идущей партии игрока с человеком. Товарищеские партии тоже считаются: рейтинг в них не
    меняется, но напротив сидит человек, и подсказки движка против него так же нечестны.
    """
    from src.services.game_state import state_manager

    return await state_manager.get_active_game_id(user_id)


async def engine_requests_during_game(game_id: int, user_id: int) -> int:
    """Сколько раз с адреса игрока запрашивали движок во время его партии (сигнал для античита)."""
    try:
        return int(await redis_module.redis_client.get(_engine_signal_key(game_id, user_id)) or 0)
    except Exception as exc:
        logger.warning("Engine request signal unavailable for game %s: %s", game_id, exc)
        return 0


async def _record_engine_signal(game_id: int, user_id: int, requester: int) -> None:
    key = _engine_signal_key(game_id, user_id)
    if await redis_module.redis_client.incr(key) == 1:
        await redis_module.redis_client.expire(key, ENGINE_SIGNAL_TTL_S)
    logger.info(
        "Fair play signal: engine requested by user %s from the address of user %s during game %s",
        requester, user_id, game_id,
    )


async def _optional_user_id(request: Request, db: AsyncSession) -> int | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    user = await user_from_token(db, token)
    return user.id if user else None


async def forbid_engine_help_during_game(request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """Зависимость FastAPI: 409, если запрос движка совпадает по времени с рейтинговой партией."""
    try:
        requester_id = await _optional_user_id(request, db)

        if requester_id is not None and await active_rated_game_id(requester_id) is not None:
            raise ApiError(status.HTTP_409_CONFLICT, "engine_locked_in_game")

        ip = client_ip(request)
        if ip == "unknown":
            return
        for raw_uid in await redis_module.redis_client.smembers(_ip_players_key(ip)):
            player_id = int(raw_uid)
            if player_id == requester_id:
                continue
            game_id = await active_rated_game_id(player_id)
            if game_id is None:
                continue
            if requester_id is None:
                raise ApiError(status.HTTP_409_CONFLICT, "engine_locked_guest_ip")
            await _record_engine_signal(game_id, player_id, requester_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Fair play check unavailable, allowing the request: %s", exc)
