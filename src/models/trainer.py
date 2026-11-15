# --- FILE: src/models/trainer.py ---
"""
Результаты тренажёров (таск 19.1): тренажёр → уровень → попытка → результат (очки, время, ошибки). Личные рекорды и
график строятся по этой таблице (src/api/trainers.py). Сами тренажёры работают на клиенте.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class TrainerResult(Base):
    __tablename__ = "trainer_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trainer: Mapped[str] = mapped_column(String(32), index=True)
    level: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer)
    time_ms: Mapped[int] = mapped_column(Integer)
    mistakes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
