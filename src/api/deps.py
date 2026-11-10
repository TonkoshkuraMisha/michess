from fastapi import Depends, HTTPException, Query, WebSocketException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.config import settings
from src.core.security import InvalidTokenError, decode_user_token
from src.db import redis as redis_module
from src.db.session import get_db, get_session_factory
from src.models.user import User

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
        db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency for HTTP endpoints to authenticate users via Bearer token in headers.
    """
    user = await user_from_token(db, token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_user_ws(
        ticket: str = Query(..., max_length=128, description="One-time ticket from POST /auth/ws-ticket"),
        session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> User:
    """
    Dependency for WebSocket endpoints: authenticates by a one-time ticket.

    JWT в адресе WebSocket попадал бы в access-логи uvicorn и прокси и жил там сутки. Вместо него
    клиент получает по HTTP (токен в заголовке) одноразовый тикет на WS_TICKET_TTL_S секунд;
    GETDEL гарантирует, что тикет сработает ровно один раз.

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
