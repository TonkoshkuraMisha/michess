"""
Позиции «Угадай ход мастера» (таблица guess_positions). Заполняет scripts/build_guess_positions.py по правилам
src/services/guess_selection.py; выдаёт и оценивает ответы src/services/guess.py.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class GuessPosition(Base):
    """
    «Угадай ход мастера» (таск 14.3): позиция из партии мастера, где ход мастера объективно находится расчётом —
    лучший ход движка с отрывом или единственный, сохраняющий результат (отбор — src/services/guess_selection.py,
    скрипт scripts/build_guess_positions.py). Позиции одной серии (несколько ходов игрока подряд) делят series_id.
    """

    __tablename__ = "guess_positions"
    __table_args__ = (UniqueConstraint("game_id", "ply", name="uq_guess_game_ply"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    # Номер полухода в партии (0 — первый ход белых): позиция — перед этим ходом.
    ply: Mapped[int] = mapped_column(Integer)
    fen: Mapped[str] = mapped_column(String(100))
    move_uci: Mapped[str] = mapped_column(String(5))
    # Оценка лучшего хода и отрыв от второго — с точки зрения стороны, которая ходит, в сантипешках.
    best_cp: Mapped[int] = mapped_column(Integer)
    gap_cp: Mapped[int] = mapped_column(Integer)
    # До трёх лучших ходов движка с оценками: [[uci, cp], …] — ответ игрока оценивается по ним без движка.
    lines: Mapped[list] = mapped_column(JSON)
    # Серия: позиции одной партии подряд, где каждый ход игрока проходит отбор.
    series_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    series_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Сложность: отрыв лучшего хода, глубина, длина серии → число, как рейтинг задачи (src/services/guess.py).
    # Меняется по ответам вошедших игроков, как рейтинг задачи (src/services/guess.py, update_rating).
    difficulty: Mapped[int] = mapped_column(Integer, index=True)
    # Коды тем реестра 13.0 (guess_selection.position_themes) — показываются после ответа.
    themes: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    plays: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    solved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
