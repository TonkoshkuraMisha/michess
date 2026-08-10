# --- FILE: src/models/move.py ---

from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime

from src.models.base import Base


class Move(Base):
    """
    Authoritative Move Journal & Anti-Cheat Telemetry.
    """
    __tablename__ = "moves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Порядковый номер полухода (ply)
    move_number: Mapped[int] = mapped_column(Integer)

    # --- CHESS DATA ---
    notation: Mapped[str] = mapped_column(String(10))  # Универсальный UCI (e.g., e2e4)
    san: Mapped[str | None] = mapped_column(String(10), nullable=True)  # Для красивого отображения (e.g., Nf3)
    fen_after: Mapped[str | None] = mapped_column(String, nullable=True)  # Состояние доски ПОСЛЕ хода
    # ------------------

    # --- TELEMETRY ---
    time_taken_ms: Mapped[int] = mapped_column(Integer)  # Client-side estimation
    window_blurred_before_move: Mapped[bool] = mapped_column(Boolean, default=False)
    is_premove: Mapped[bool] = mapped_column(Boolean, default=False)
    network_lag_ms: Mapped[int] = mapped_column(Integer, default=0)

    # Server-side timestamp
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())