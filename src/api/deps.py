"""
Проверка входа — зависимости маршрутов.

* get_current_user — для HTTP: игрок по токену из заголовка «Authorization: Bearer». Токен принимается, только
  пока его версия совпадает с users.token_version (user_from_token): смена пароля и «выйти везде» отзывают все
  прежние токены. Попутно игрок отмечается активным за сутки — для метрик (src/core/observability.py,
  src/services/product_metrics.py).
* get_current_user_ws — для WebSocket: вход по одноразовому тикету. Тикет выдаёт POST /auth/ws-ticket и кладёт в
  Redis (ключ ws_ticket:<тикет>, срок WS_TICKET_TTL_S); здесь он забирается командой GETDEL и поэтому срабатывает
  ровно один раз. Токен в адресе WebSocket не используется: адреса попадают в журналы сервера и прокси.
"""

from fastapi import Depends, Query, WebSocketException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.config import settings
from src.core.errors import ApiError
from src.core.logging_setup import bind_log_context
from src.core.observability import note_active_player
from src.core.security import InvalidTokenError, decode_user_token
from src.db import redis as redis_module
from src.db.session import get_db, get_session_factory
from src.models.user import User
from src.services import product_metrics

# Схема для извлечения токена из заголовка Authorization: Bearer
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

WS_TICKET_PREFIX = "ws_ticket:"


async def user_from_token(db: AsyncSession, token: str) -> User | None:
    """
    Пользователь по JWT или None. Токен действителен, только пока его версия совпадает с
    users.token_version: смена пароля и «выйти на всех устройствах» её увеличивают.
    """
    try:
        user_id, version = decode_user_token(token)
    except InvalidTokenError:
        return None
    user = await db.get(User, user_id)
    if user is None or user.token_version != version:
        return None
    return user


async def get_current_user(
        token: str = Depends(oauth2_scheme),
        db: AsyncSession = Depends(get_db),
        session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> User:
    """
    Зависимость HTTP-эндпоинтов «только для вошедших»: игрок по токену из заголовка Authorization: Bearer, иначе
    401 not_authenticated. Заодно отмечает игрока активным за сутки: счётчик в Redis для метрики
    regence_active_players_today и событие в product_events (не чаще раза в сутки).
    """
    user = await user_from_token(db, token)
    if user is None:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "not_authenticated", headers={"WWW-Authenticate": "Bearer"})
    bind_log_context(user_id=user.id)  # каждая строка журнала этого запроса несёт игрока (src/core/logging_setup.py)
    await note_active_player(user.id)  # для метрики «процессор на активного игрока» (таск 23.3)
    await product_metrics.mark_active(session_factory, user.id)  # удержание D1/D7/D30 (таск 23.5)
    return user


async def get_current_user_ws(
        ticket: str = Query(..., max_length=128, description="One-time ticket from POST /auth/ws-ticket"),
        session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> User:
    """
    Зависимость WebSocket: вход по одноразовому тикету из параметра адреса ?ticket=. Неверный, истёкший или уже
    использованный тикет — закрытие с кодом 1008; Redis недоступен — 1011.

    JWT в адресе WebSocket попадал бы в access-логи uvicorn и прокси и оставался бы там рабочим до конца своего
    срока. Вместо него клиент получает по HTTP (токен в заголовке) одноразовый тикет на WS_TICKET_TTL_S секунд;
    GETDEL гарантирует, что тикет сработает ровно один раз. В Redis под ключом ws_ticket:<тикет> лежит
    «id игрока:версия токенов».

    Пользователь читается в короткой сессии, которая закрывается сразу: зависимость с get_db
    держала бы соединение пула всё время, пока открыт WebSocket. Возвращаемый объект
    отсоединён от сессии, его поля уже загружены.
    """
    rejected = WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired ticket")
    try:
        raw = await redis_module.redis_client.getdel(f"{WS_TICKET_PREFIX}{ticket}")
    except Exception as exc:
        raise WebSocketException(code=status.WS_1011_INTERNAL_ERROR, reason="Ticket store unavailable") from exc
    if not raw:
        raise rejected

    user_id_str, _, version_str = str(raw).partition(":")
    async with session_factory() as db:
        user = await db.get(User, int(user_id_str))

    # Токены отозвали между выдачей тикета и подключением — тикет тоже недействителен.
    if user is None or str(user.token_version) != version_str:
        raise rejected
    return user
