from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime

from src.models.base import Base


class Move(Base):
    """
    Stores individual moves along with rich anti-cheat telemetry.
    """
    __tablename__ = "moves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    move_number: Mapped[int] = mapped_column(Integer)
    notation: Mapped[str] = mapped_column(String(10))  # e.g., "e2e4" or "Nf3"

    # Anti-cheat deterministic traps
    time_taken_ms: Mapped[int] = mapped_column(Integer)
    window_blurred_before_move: Mapped[bool] = mapped_column(Boolean, default=False)
    is_premove: Mapped[bool] = mapped_column(Boolean, default=False)
    network_lag_ms: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())