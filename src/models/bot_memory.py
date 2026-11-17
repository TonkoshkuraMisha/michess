# --- FILE: src/models/bot_memory.py ---
"""
Память ботов (таск 32.1): статистика их дебютных вариантов по сыгранным партиям и рейтинг, измеряемый по партиям
с людьми. Правила — src/services/bots/memory.py.
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class BotOpeningStat(Base):
    """Ход книги бота в позиции (ключ FEN без счётчиков) и его итог для бота: партии и набранные очки."""

    __tablename__ = "bot_opening_stats"
    __table_args__ = (UniqueConstraint("bot_id", "fen_key", "uci", name="uq_bot_opening_stat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    bot_id: Mapped[str] = mapped_column(String(40), index=True)
    fen_key: Mapped[str] = mapped_column(String(100))
    uci: Mapped[str] = mapped_column(String(5))
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    points: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")


class BotRating(Base):
    """Рейтинг бота по партиям с людьми и поправка силы движка, если расхождение с заявленной силой устойчиво."""

    __tablename__ = "bot_ratings"

    bot_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    rating: Mapped[float] = mapped_column(Float)
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Поправка к UCI_Elo бота (в пределах memory.MAX_OFFSET); пересчитывается раз в memory.OFFSET_EVERY партий.
    offset: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    offset_games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
