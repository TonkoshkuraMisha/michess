from fastapi import Depends, Query, WebSocketException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import jwt

from src.core.config import settings
from src.db.session import get_db
from src.models.user import User


async def get_current_user_ws(
        token: str = Query(..., description="JWT access token passed as a query parameter"),
        db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency for WebSocket endpoints to authenticate users via query parameter token.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token payload")
    except jwt.InvalidTokenError:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if user is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="User not found")

    return user