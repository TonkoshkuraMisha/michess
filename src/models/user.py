from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.models.base import Base

RatingCategory = Literal["bullet", "blitz", "rapid", "classical"]
RATING_CATEGORIES: tuple[RatingCategory, ...] = ("bullet", "blitz", "rapid", "classical")


class User(Base):
    """
    Core user model for authentication and matchmaking.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    # Нормализованное имя (casefold) аккаунтов, входящих по паролю: уникальность без учёта
    # регистра («Misha» и «misha» — один аккаунт) и вход в любом регистре. У архивных игроков
    # из PGN и ботов — NULL: их имена из заголовков партий могут различаться только регистром,
    # а NULL уникальный индекс не ограничивает.
    username_key: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String)
    # Версия токенов: входит в JWT и сверяется при каждой проверке. Увеличение (смена пароля,
    # «выйти на всех устройствах») делает недействительными все ранее выданные токены.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # ELO-рейтинг по отдельности для каждой категории контроля времени (как на chess.com и
    # lichess.org) — единого «общего» рейтинга больше нет, пуля/блиц/рапид/классика не
    # сравнимы между собой. Категория определяется по base_time_ms/increment_ms партии,
    # см. src.services.rating.classify_time_control.
    bullet_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    blitz_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    rapid_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)
    classical_rating: Mapped[int] = mapped_column(Integer, default=1200, server_default="1200", nullable=False)

    # Число сыгранных рейтинговых партий в каждой категории — определяет K-фактор ELO
    # (новичкам рейтинг двигается быстрее). Хранится как счётчик, а не через COUNT(*) по
    # games при каждом завершении партии.
    bullet_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    blitz_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    rapid_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    classical_games_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Исторический бот (играбельный AI) или архивный исторический игрок (партии из PGN,
    # посмотреть — нельзя сыграть) — не реальный зарегистрированный игрок, вне таблицы лидеров.
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Anti-cheat specific fields
    is_cheater: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    trust_factor: Mapped[int] = mapped_column(Integer, default=100)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def rating_for(self, category: RatingCategory) -> int:
        return getattr(self, f"{category}_rating")

    def games_played_for(self, category: RatingCategory) -> int:
        return getattr(self, f"{category}_games_played")
