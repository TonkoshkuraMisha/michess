# --- FILE: src/models/social.py ---
"""
Игроки и уведомления (таск 17.1): подписки (взаимная подписка — «друзья») и центр уведомлений. Тексты уведомлений
собирает клиент по коду вида (kind) и параметрам (payload) — сервер строк для людей не хранит.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
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
    # challenge | rematch | tournament_round | report_answer | workout_reminder
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
