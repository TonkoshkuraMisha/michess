# --- FILE: src/services/email_links.py ---
"""
E-mail игрока и сброс пароля (таск 17.5).

* Подтверждение адреса: игрок вводит адрес (с паролем), на него уходит одноразовая ссылка; адрес записывается в
  профиль только по ссылке. Пока не подтверждён — он нигде не числится, и чужой адрес так не занять.
* Сброс пароля: по подтверждённому адресу уходит одноразовая ссылка на час. Ответ на запрос всегда одинаковый —
  по нему не узнать, есть ли такой адрес. Новый пароль отзывает все токены и прочие ссылки сброса.

Где хранится: ссылки — таблица email_tokens (назначение, адрес, срок, отметка использования); в базе лежит только
sha256 от секрета ссылки, сам секрет есть лишь в письме. Сроки — настройки EMAIL_VERIFY_TTL_S (сутки) и
PASSWORD_RESET_TTL_S (час), адрес сайта в ссылке — PUBLIC_BASE_URL. Письма собирает и отправляет
src/services/mailer.py (без SMTP_HOST письмо не уходит, а пишется в лог). Лимиты запросов писем (на адрес и на
IP, настройки RATE_LIMIT_EMAIL_*) — в маршрутах src/api/account.py.
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

# Назначение ссылки (email_tokens.purpose): подтверждение адреса и сброс пароля. Ссылка одного назначения не
# принимается там, где ждут другое.
VERIFY = "verify"
RESET = "reset"


def normalize(email: str) -> str:
    """Адрес в виде для сравнения и хранения: без пробелов по краям, в нижнем регистре."""
    return email.strip().lower()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def _issue(db: AsyncSession, user: User, purpose: str, email: str, ttl_s: int) -> str:
    """Новая одноразовая ссылка: в базу пишется хэш секрета и срок (с commit), возвращается сам секрет для письма."""
    token = secrets.token_urlsafe(32)
    db.add(EmailToken(user_id=user.id, purpose=purpose, token_hash=_hash(token), email=email,
                      expires_at=_now() + timedelta(seconds=ttl_s)))
    await db.commit()
    return token


async def _taken(db: AsyncSession, email: str, user_id: int) -> bool:
    """Записан ли этот адрес (без учёта регистра) в профиле другого игрока."""
    other = await db.scalar(select(User.id).where(func.lower(User.email) == email, User.id != user_id))
    return other is not None


async def request_verification(db: AsyncSession, user: User, email: str, language: str) -> None:
    """
    Письмо с одноразовой ссылкой для подтверждения адреса. Адрес, уже подтверждённый другим игроком, — отказ
    email_taken.
    """
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
    """
    Находит ссылку по хэшу секрета и назначению и помечает её использованной (без commit — его делает вызывающий).
    Неизвестная, уже использованная или просроченная ссылка — отказ 400 email_link_invalid.
    """
    row = await db.scalar(select(EmailToken).where(EmailToken.token_hash == _hash(token), EmailToken.purpose == purpose))
    if row is None or row.used_at is not None or _aware(row.expires_at) < _now():
        raise ApiError(400, "email_link_invalid")
    row.used_at = _now()
    return row


async def confirm_verification(db: AsyncSession, token: str) -> User:
    """
    Переход по ссылке из письма: адрес записывается в профиль. Недействительная, просроченная или уже использованная
    ссылка — отказ. Если за время до перехода адрес подтвердил другой игрок — отказ email_taken.
    """
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
    """
    Новый пароль по ссылке из письма: хэш заменяется, все токены и остальные ссылки сброса игрока отзываются, открытые
    соединения закрываются.
    """
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
