# --- FILE: src/models/imported_game.py ---
"""
Партии игрока с других сайтов (таск 24.1): lichess, chess.com или вставленный PGN.

Отдельная таблица, а не games: чужая партия не участвует в рейтинге, архиве, статистике профиля, дереве дебютов и
лиге — она нужна только для разбора с наставником и личных задач (13.5). Соперник — просто имя из PGN.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class ImportedGame(Base):
    """
    Партия игрока, принесённая с другого сайта или вставленная как PGN: принадлежит одному игроку, хранит запись
    ходов, сведения из заголовков и разбор движком.
    """
    __tablename__ = "imported_games"
    __table_args__ = (UniqueConstraint("user_id", "source", "external_id", name="uq_imported_games_source_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # lichess | chesscom | pgn; external_id — id партии на сайте, для PGN — хеш ходов (повторная вставка не дублирует).
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Сторона игрока и имена из заголовков PGN.
    color: Mapped[str] = mapped_column(String(5), nullable=False)
    white_name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    black_name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    white_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str] = mapped_column(String(10), nullable=False, default="*")
    # bullet | blitz | rapid | classical | daily; None — неизвестно (вставленный PGN).
    speed: Mapped[str | None] = mapped_column(String(12), nullable=True)
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    pgn: Mapped[str] = mapped_column(Text, nullable=False)
    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
