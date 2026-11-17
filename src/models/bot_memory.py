# --- FILE: src/models/bot_memory.py ---
"""
Память ботов (таск 32.1): статистика их дебютных вариантов по сыгранным партиям и рейтинг, измеряемый по партиям
с людьми (32.1), память о постоянных соперниках (32.2). Правила — src/services/bots/memory.py.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
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


class BotRival(Base):
    """Постоянный соперник бота (таск 32.2): сколько партий сыграно с игроком и сколько очков в них набрал бот."""

    __tablename__ = "bot_rivals"
    __table_args__ = (UniqueConstraint("bot_id", "user_id", name="uq_bot_rival"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    bot_id: Mapped[str] = mapped_column(String(40))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    points: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")


class BotRivalStat(Base):
    """Ход книги бота против конкретного игрока: итог для бота и проиграна ли последняя партия с этим ходом."""

    __tablename__ = "bot_rival_stats"
    __table_args__ = (UniqueConstraint("bot_id", "user_id", "fen_key", "uci", name="uq_bot_rival_stat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    bot_id: Mapped[str] = mapped_column(String(40))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    fen_key: Mapped[str] = mapped_column(String(100))
    uci: Mapped[str] = mapped_column(String(5))
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    points: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    last_lost: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
