# --- FILE: src/models/arena.py ---
"""
Арены — турниры между людьми (таск 17.2): идут заданное время, игроки играют партию за партией с теми, кто тоже ждёт;
очки за партию, серия побед удваивает очки («огонь»). Правила — src/services/arena.py.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Arena(Base):
    __tablename__ = "arenas"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Код расписания (например, «blitz-3+2»), чтобы не создавать одну и ту же арену дважды; пусто — разовая арена.
    schedule_key: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    base_time_ms: Mapped[int] = mapped_column(Integer)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArenaPlayer(Base):
    __tablename__ = "arena_players"
    __table_args__ = (UniqueConstraint("arena_id", "user_id", name="uq_arena_player"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    arena_id: Mapped[int] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Побед подряд: с ARENA_FIRE_AFTER и дальше партия приносит вдвое больше очков.
    streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Рейтинг в категории арены на момент входа — для пар и таблицы.
    rating: Mapped[int] = mapped_column(Integer)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArenaGame(Base):
    __tablename__ = "arena_games"

    id: Mapped[int] = mapped_column(primary_key=True)
    arena_id: Mapped[int] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), unique=True)
    white_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    black_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    result: Mapped[str | None] = mapped_column(String(8), nullable=True)
    white_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
