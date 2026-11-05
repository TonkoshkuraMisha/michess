# --- FILE: src/models/game.py ---

import enum
from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, Boolean, DateTime, ForeignKey, Enum, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base


class GameStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    white_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    black_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    pgn: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[GameStatus] = mapped_column(
        Enum(GameStatus, name="gamestatus"),
        default=GameStatus.PENDING,
        nullable=False,
        index=True,
    )

    base_time_ms: Mapped[int] = mapped_column(Integer, default=180000, server_default="180000", nullable=False)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_rated: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    state_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    turn: Mapped[str] = mapped_column(String(1), default="w", server_default="w", nullable=False)
    board_fen: Mapped[str] = mapped_column(
        String,
        default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        server_default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        nullable=False,
    )

    white_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_move_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    termination: Mapped[str | None] = mapped_column(String(50), nullable=True)
    winner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    white_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    white_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    pgn_date: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    site: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    eco: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)

    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    white_player = relationship("User", foreign_keys=[white_player_id])
    black_player = relationship("User", foreign_keys=[black_player_id])
    moves = relationship("Move", cascade="all, delete-orphan")
