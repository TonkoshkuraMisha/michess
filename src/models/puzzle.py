# --- FILE: src/models/puzzle.py ---
"""
Задачи (таск 13.1). Источник — открытая база задач lichess (CC0), выборка — data/puzzles/. Формат ходов — как в
базе: `moves[0]` — ход соперника, который создаёт задачу, дальше чередуются ход решающего и ответ.
Темы — коды реестра (src/services/themes.py) в отдельной таблице, чтобы выбирать задачи по теме индексом.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base


class Puzzle(Base):
    __tablename__ = "puzzles"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_puzzles_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[str] = mapped_column(String(20), nullable=False)
    # Позиция до хода соперника (moves[0]); решающий играет за сторону, которая ходит после него.
    fen: Mapped[str] = mapped_column(String(100), nullable=False)
    moves: Mapped[str] = mapped_column(String(400), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    rating_deviation: Mapped[int] = mapped_column(Integer, nullable=False, default=75)
    popularity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    plays: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Исходные теги базы — для повторной разметки при изменении реестра.
    source_tags: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    themes: Mapped[list["PuzzleTheme"]] = relationship(
        back_populates="puzzle", cascade="all, delete-orphan", lazy="selectin",
    )

    @property
    def theme_codes(self) -> list[str]:
        return [t.theme for t in self.themes]


class PuzzleTheme(Base):
    __tablename__ = "puzzle_themes"

    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id", ondelete="CASCADE"), primary_key=True)
    theme: Mapped[str] = mapped_column(String(40), primary_key=True, index=True)

    puzzle: Mapped[Puzzle] = relationship(back_populates="themes")


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    puzzle_id: Mapped[int] = mapped_column(ForeignKey("puzzles.id", ondelete="CASCADE"), nullable=False, index=True)
    solved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    hints_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_before: Mapped[int] = mapped_column(Integer, nullable=False)
    rating_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
