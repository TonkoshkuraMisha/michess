# --- FILE: src/models/beta.py ---
"""
Программа беты (таск 24.4): коды-приглашения для закрытой регистрации и сообщения «Сообщить о проблеме».

Приглашения создаёт и отзывает модератор; uses — сколько человек зарегистрировалось по коду (и основа лимита).
Сообщение о проблеме может прийти и от гостя (user_id пуст); к тексту игрока сервер и клиент прикладывают
контекст: страницу, версию приложения, язык и размер экрана.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Invite(Base):
    """
    Код-приглашение для закрытой регистрации: лимит использований, срок действия, отзыв; uses — сколько человек уже
    зарегистрировалось по коду.
    """
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # Пометка модератора для себя: кому выдан код (ввод человека, не строка интерфейса).
    note: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Пусто — без лимита.
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    """
    Сообщение «Сообщить о проблеме»: текст игрока или гостя, контекст (страница, версия, язык, размер экрана) и статус
    разбора модератором.
    """
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    message: Mapped[str] = mapped_column(String(2000))
    # Контекст: путь страницы, версия приложения, язык интерфейса, размер экрана («1280x720»).
    page: Mapped[str | None] = mapped_column(String(200), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    screen: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # new | in_progress | done | rejected
    status: Mapped[str] = mapped_column(String(16), default="new", server_default="new", index=True)
    moderator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
