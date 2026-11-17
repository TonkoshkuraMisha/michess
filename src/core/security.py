"""
Пароли и токены входа.

* Пароль хранится только как хэш bcrypt (users.hashed_password). У ботов и архивных игроков вместо хэша стоит
  метка, которая не совпадает ни с одним паролем, — войти под ними нельзя.
* Access-токен — JWT, подписанный SECRET_KEY: sub — id игрока (имя можно сменить, id — нет), ver — версия токенов
  (users.token_version). Смена пароля и «выйти везде» увеличивают версию, и все выданные раньше токены перестают
  приниматься (проверка — src/api/deps.user_from_token). Срок жизни — ACCESS_TOKEN_EXPIRE_MINUTES.

Долгий вход (refresh-токен в cookie) — src/services/auth_sessions.py.
"""

from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from src.core.config import settings

# Password hashing context using bcrypt algorithm
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a hashed counterpart.

    A hash passlib cannot identify (e.g. the marker stored for bot accounts) never matches
    instead of raising and turning a login attempt into a 500.
    """
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError):
        return False


def get_password_hash(password: str) -> str:
    """Generates a secure bcrypt hash for a plain password."""
    return pwd_context.hash(password)


class InvalidTokenError(Exception):
    """Токен не подписан нами, истёк или имеет старый формат."""


def create_user_token(user, expires_delta: timedelta | None = None) -> str:
    """
    JWT пользователя: sub — id (имя можно было бы сменить, id — нет), ver — версия токенов,
    по которой отзываются все выданные ранее токены.
    """
    return create_access_token({"sub": str(user.id), "ver": int(user.token_version or 0)}, expires_delta)


def decode_user_token(token: str) -> tuple[int, int]:
    """(user_id, token_version) из токена; InvalidTokenError для чужих, истёкших и старых токенов."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.InvalidTokenError as exc:
        raise InvalidTokenError(str(exc)) from exc
    subject, version = payload.get("sub"), payload.get("ver")
    # Токены старого формата (sub = имя пользователя, без ver) не принимаются: войти заново.
    if not isinstance(subject, str) or not subject.isdigit() or not isinstance(version, int):
        raise InvalidTokenError("unsupported token format")
    return int(subject), version


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Generates a JSON Web Token (JWT) for user authentication."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt
