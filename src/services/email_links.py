# --- FILE: src/services/email_links.py ---
"""
E-mail игрока и сброс пароля (таск 17.5).

* Подтверждение адреса: игрок вводит адрес (с паролем), на него уходит одноразовая ссылка; адрес записывается в
  профиль только по ссылке. Пока не подтверждён — он нигде не числится, и чужой адрес так не занять.
* Сброс пароля: по подтверждённому адресу уходит одноразовая ссылка на час. Ответ на запрос всегда одинаковый —
  по нему не узнать, есть ли такой адрес. Новый пароль отзывает все токены и прочие ссылки сброса.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.errors import ApiError
from src.core.security import get_password_hash
from src.models.email_token import EmailToken
from src.models.user import User
from src.services import mailer

VERIFY = "verify"
RESET = "reset"


def normalize(email: str) -> str:
    return email.strip().lower()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _issue(db: AsyncSession, user: User, purpose: str, email: str, ttl_s: int) -> str:
    token = secrets.token_urlsafe(32)
    db.add(EmailToken(user_id=user.id, purpose=purpose, token_hash=_hash(token), email=email,
                      expires_at=_now() + timedelta(seconds=ttl_s)))
    await db.commit()
    return token


async def _taken(db: AsyncSession, email: str, user_id: int) -> bool:
    other = await db.scalar(select(User.id).where(func.lower(User.email) == email, User.id != user_id))
    return other is not None


async def request_verification(db: AsyncSession, user: User, email: str, language: str) -> None:
    email = normalize(email)
    if await _taken(db, email, user.id):
        raise ApiError(409, "email_taken")
    token = await _issue(db, user, VERIFY, email, settings.EMAIL_VERIFY_TTL_S)
    subject, body = mailer.render(
        "verify", language, username=user.username, hours=settings.EMAIL_VERIFY_TTL_S // 3600,
        link=f"{settings.PUBLIC_BASE_URL.rstrip('/')}/verify-email?token={token}",
    )
    await mailer.send(email, subject, body)


async def _consume(db: AsyncSession, token: str, purpose: str) -> EmailToken:
    row = await db.scalar(select(EmailToken).where(EmailToken.token_hash == _hash(token), EmailToken.purpose == purpose))
    if row is None or row.used_at is not None or _aware(row.expires_at) < _now():
        raise ApiError(400, "email_link_invalid")
    row.used_at = _now()
    return row


async def confirm_verification(db: AsyncSession, token: str) -> User:
    row = await _consume(db, token, VERIFY)
    user = await db.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(400, "email_link_invalid")
    if await _taken(db, row.email, user.id):
        raise ApiError(409, "email_taken")
    user.email = row.email
    await db.commit()
    return user


async def request_reset(db: AsyncSession, email: str, language: str) -> None:
    """Письмо со ссылкой сброса, если адрес подтверждён у живого аккаунта; иначе — ничего (и тот же ответ)."""
    email = normalize(email)
    user = await db.scalar(select(User).where(func.lower(User.email) == email, User.deleted_at.is_(None)))
    if user is None:
        return
    token = await _issue(db, user, RESET, email, settings.PASSWORD_RESET_TTL_S)
    subject, body = mailer.render(
        "reset", language, username=user.username, hours=max(1, settings.PASSWORD_RESET_TTL_S // 3600),
        link=f"{settings.PUBLIC_BASE_URL.rstrip('/')}/reset-password?token={token}",
    )
    await mailer.send(email, subject, body)


async def confirm_reset(db: AsyncSession, token: str, new_password: str) -> User:
    row = await _consume(db, token, RESET)
    user = await db.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(400, "email_link_invalid")
    user.hashed_password = get_password_hash(new_password)
    user.token_version = (user.token_version or 0) + 1
    # Остальные ссылки сброса этого игрока больше не действуют.
    await db.execute(update(EmailToken).where(
        EmailToken.user_id == user.id, EmailToken.purpose == RESET, EmailToken.used_at.is_(None),
    ).values(used_at=_now()))
    await db.commit()
    from src.services.connection_manager import manager

    await manager.revoke_sessions(user.id)
    return user
