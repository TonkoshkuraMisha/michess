# --- FILE: src/models/game.py ---

from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum, Boolean, BigInteger
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime
import enum

from src.models.base import Base


class GameStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ABORTED = "aborted"


class Game(Base):
    """
    Authoritative Game Model.
    """
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    white_player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    black_player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Time controls (в миллисекундах)
    base_time_ms: Mapped[int] = mapped_column(Integer, default=180000)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0)
    is_rated: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- AUTHORITATIVE STATE (HOT DATA) ---
    # Версия состояния для защиты от race conditions (TASK-006)
    state_version: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    # Очередь хода ('w' или 'b')
    turn: Mapped[str] = mapped_column(String(1), server_default="'w'", default='w')
    # Текущее состояние доски
    board_fen: Mapped[str] = mapped_column(String,
                                           server_default="'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'",
                                           default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    # Оставшееся время (устанавливается при старте)
    white_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # UNIX timestamp (ms) последнего хода для серверного расчета времени
    last_move_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # --------------------------------------

    # --- MATCH COMPLETION DATA (TASK-002) ---
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "1-0", "0-1", "1/2-1/2"
    termination: Mapped[str | None] = mapped_column(String(50),
                                                    nullable=True)  # checkmate, timeout, agreement, resignation, aborted
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Rating snapshots
    white_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    white_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ----------------------------------------

    # Standard chess notation (Архивное поле)
    pgn: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[GameStatus] = mapped_column(Enum(GameStatus), default=GameStatus.PENDING)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)