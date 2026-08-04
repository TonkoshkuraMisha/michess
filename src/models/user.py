from sqlalchemy import String, Boolean, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from datetime import datetime

from src.models.base import Base


class User(Base):
    """
    Core user model for authentication and matchmaking.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String)

    # ELO or Glicko-2 rating
    rating: Mapped[int] = mapped_column(Integer, default=1200)

    # Anti-cheat specific fields
    is_cheater: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    trust_factor: Mapped[int] = mapped_column(Integer, default=100)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())