from fastapi import Depends, Query, WebSocketException, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import select
import jwt

from src.core.config import settings
from src.db.session import get_db, get_session_factory
from src.models.user import User

# Схема для извлечения токена из заголовка Authorization: Bearer
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


async def get_current_user(
        token: str = Depends(oauth2_scheme),
        db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency for HTTP endpoints to authenticate users via Bearer token in headers.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if user is None:
        raise credentials_exception

    return user


async def get_current_user_ws(
        token: str = Query(..., description="JWT access token passed as a query parameter"),
        session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
) -> User:
    """
    Dependency for WebSocket endpoints to authenticate users via query parameter token.

    Пользователь читается в короткой сессии, которая закрывается сразу: зависимость с get_db
    держала бы соединение пула всё время, пока открыт WebSocket. Возвращаемый объект
    отсоединён от сессии, его поля уже загружены.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token payload")
    except jwt.InvalidTokenError:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")

    async with session_factory() as db:
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalars().first()

    if user is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="User not found")

    return user
