# --- FILE: src/models/email_token.py ---
"""
Одноразовые ссылки из писем (таск 17.5): подтверждение e-mail и сброс пароля. В базе — только SHA-256 токена:
утечка таблицы не даёт рабочих ссылок. Ссылка действует до expires_at и один раз (used_at).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.models.base import Base


class EmailToken(Base):
    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)  # verify | reset
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # Для подтверждения — адрес, который подтверждают; для сброса — адрес, на который ушло письмо.
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
