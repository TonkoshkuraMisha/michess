# --- FILE: src/models/ladder.py ---
"""
Клубная лестница (таски 10.4, 21.4, задача 7 плана владельца 18.11): какие ступени игрок прошёл. Ступень — ключ
соперника («morphy», «archetype:rusher»), а не номер в списке: новые соперники встают в лестницу по силе, и прогресс
игроков от этого не сдвигается. Текущую ступень считает src/services/ladder.py по этому множеству.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class LadderBeaten(Base):
    """Пройденная ступень: игрок победил этого соперника, когда тот был его текущей ступенью."""
    __tablename__ = "ladder_beaten"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Ключ ступени (src/services/ladder.Rung.key): id исторического бота или «archetype:<id>».
    rung_key: Mapped[str] = mapped_column(String(48), primary_key=True)
    beaten_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
