from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum, Boolean
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
    Represents a single chess match between two players with time controls.
    """
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Foreign keys to the User table
    white_player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    black_player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Time controls (в миллисекундах)
    base_time_ms: Mapped[int] = mapped_column(Integer, default=180000)  # По умолчанию 3 минуты (180000 мс)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0)       # По умолчанию без добавки

    # Рейтинговая ли игра
    is_rated: Mapped[bool] = mapped_column(Boolean, default=True)

    # Standard chess notation of the whole game (PGN)
    pgn: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[GameStatus] = mapped_column(Enum(GameStatus), default=GameStatus.PENDING)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)