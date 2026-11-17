# --- FILE: src/models/social.py ---
"""
Игроки и уведомления (таск 17.1): подписки (взаимная подписка — «друзья») и центр уведомлений. Тексты уведомлений
собирает клиент по коду вида (kind) и параметрам (payload) — сервер строк для людей не хранит.
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id", name="uq_follow_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    follower_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followee_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # challenge | rematch | tournament_round | report_answer | workout_reminder | post_comment | arena_reminder
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DirectMessage(Base):
    """Личное сообщение (таск 30.1). Текст — ввод игрока; вложение — карточка {kind, ref, ...снимок} без строк
    интерфейса. pair_key = «меньший_id:больший_id» — переписка двух игроков одним индексом."""

    __tablename__ = "direct_messages"
    __table_args__ = (Index("ix_direct_messages_pair_id", "pair_key", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    pair_key: Mapped[str] = mapped_column(String(24))
    sender_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(1000), default="", server_default="")
    attachment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Придержано фильтром оскорблений (таск 30.3): видно только отправителю до решения модератора.
    held: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)


class Block(Base):
    """Чёрный список (таск 30.1): blocker не получает сообщений от blocked и не пишет ему сам."""

    __tablename__ = "blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    blocker_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Post(Base):
    """Публикация в ленте (таск 30.2): текст игрока и/или карточка (src/services/attachments.py). hidden_at —
    скрыта модератором (таск 30.3): автору видна, в лентах — нет."""

    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(2000), default="", server_default="")
    attachment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    held: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)


class PostComment(Base):
    __tablename__ = "post_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    held: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_like"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HiddenConversation(Base):
    """«Скрыть собеседника» (таск 30.3): переписка не показывается в моём списке, пока он не напишет снова
    (новое сообщение с id больше up_to_id). Без блокировки: писать он по-прежнему может."""

    __tablename__ = "hidden_conversations"
    __table_args__ = (UniqueConstraint("user_id", "other_id", name="uq_hidden_conversation"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    other_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    up_to_id: Mapped[int] = mapped_column(Integer)
