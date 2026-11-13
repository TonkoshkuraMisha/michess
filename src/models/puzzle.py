# --- FILE: src/models/puzzle.py ---
"""
Задачи (таск 13.1). Источник — открытая база задач lichess (CC0), выборка — data/puzzles/. Формат ходов — как в
базе: `moves[0]` — ход соперника, который создаёт задачу, дальше чередуются ход решающего и ответ.
Темы — коды реестра (src/services/themes.py) в отдельной таблице, чтобы выбирать задачи по теме индексом.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
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
    # Ступень (таск 13.4): 1 — знакомство, 2 — закрепление, 3 — в сочетании, 4 — мастер (см. stage_for).
    stage: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)
    # Версия разметки тем (src/services/puzzle_import.TAG_VERSION): старая — задача переразмечается при импорте.
    tag_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
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


class ThemeProgress(Base):
    """Прогресс игрока по теме (таск 13.4): ступень, последние результаты на ней ('1' — чисто, '0' — нет)."""
    __tablename__ = "theme_progress"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    theme: Mapped[str] = mapped_column(String(40), primary_key=True)
    stage: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    recent: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default="")
    solved: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    mastered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class PersonalPuzzle(Base):
    """
    Задача из партии игрока (таск 13.5): позиция перед его ошибкой и единственный сильный ход. Повторение с
    интервалами: нерешённая возвращается через 1, 3, 7, 21 день, пока не решится дважды подряд (тогда done).
    """
    __tablename__ = "personal_puzzles"
    __table_args__ = (UniqueConstraint("user_id", "game_id", "ply", name="uq_personal_puzzles_move"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), nullable=False, index=True)
    # Полуход ошибки (1 — первый ход партии) и позиция перед ним; предыдущий ход — для подсветки.
    ply: Mapped[int] = mapped_column(Integer, nullable=False)
    fen: Mapped[str] = mapped_column(String(100), nullable=False)
    previous_move: Mapped[str | None] = mapped_column(String(5), nullable=True)
    solution: Mapped[str] = mapped_column(String(5), nullable=False)
    played: Mapped[str] = mapped_column(String(5), nullable=False)
    cp_loss: Mapped[int] = mapped_column(Integer, nullable=False)
    themes: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    interval_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solved_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DefenseDrill(Base):
    """
    Защитное упражнение (таск 13.6, src/services/defense_drills.py): «Что грозит соперник?» (kind=threat) и «Не
    зевни» (kind=blunder). Позиция — с очередью хода обороняющегося; угроза и верные ходы клиенту не отправляются.
    """
    __tablename__ = "defense_drills"
    __table_args__ = (
        UniqueConstraint("kind", "source", "source_id", name="uq_defense_drills_source"),
        Index("ix_defense_drills_kind_stage", "kind", "stage"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[str] = mapped_column(String(20), nullable=False)
    fen: Mapped[str] = mapped_column(String(100), nullable=False)
    # threat: ход соперника, который грозит (если бы ход был его); blunder — нет.
    threat: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # blunder: три хода на выбор и опровержения проигрывающих («ход:ответ» через пробел).
    choices: Mapped[str] = mapped_column(String(20), nullable=False, default="", server_default="")
    refutations: Mapped[str] = mapped_column(String(30), nullable=False, default="", server_default="")
    good_moves: Mapped[str] = mapped_column(String(30), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    stage: Mapped[int] = mapped_column(Integer, nullable=False)
    # Темы тактики, которая стоит за угрозой или зевком (из исходной задачи) — объяснение после ответа.
    motifs: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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
