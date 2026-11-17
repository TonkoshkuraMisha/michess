# --- FILE: src/models/achievement.py ---
"""Открытые достижения игрока (таск 17.6): код и дата; условия — src/services/achievements.py."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class UserAchievement(Base):
    """
    Достижение, открытое игроком: код достижения и дата. Одно достижение записывается один раз; условия проверяет
    src/services/achievements.py.
    """
    __tablename__ = "user_achievements"
    __table_args__ = (UniqueConstraint("user_id", "code", name="uq_user_achievement"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
