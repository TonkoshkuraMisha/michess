# --- FILE: src/models/position.py ---
"""
Индекс позиций (таск 16.1): статистика ходов из позиции и партии, через которые позиция проходила. Позиция — хэш
Zobrist (python-chess, 64 бита; в базе — со знаком, чтобы влезть в BIGINT). Глубина индекса — первые
position_index.MAX_PLIES полуходов партии. Сборка — src/services/position_index.py.
"""

from sqlalchemy import BigInteger, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class PositionStat(Base):
    """
    Статистика одного хода из позиции: сколько партий через него прошло и чем они закончились (победы белых, ничьи,
    победы чёрных).
    """
    __tablename__ = "position_stats"
    __table_args__ = (UniqueConstraint("position_hash", "move_uci", name="uq_position_stats_move"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Отдельный индекс не нужен: колонка — первая в уникальном индексе (ревизия 29.1).
    position_hash: Mapped[int] = mapped_column(BigInteger)
    move_uci: Mapped[str] = mapped_column(String(5))
    white_wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    draws: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    black_wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PositionGame(Base):
    """Партия, прошедшая через позицию (один раз на партию, даже если позиция повторялась)."""

    __tablename__ = "position_games"
    __table_args__ = (UniqueConstraint("position_hash", "game_id", name="uq_position_games_game"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Отдельный индекс не нужен: колонка — первая в уникальном индексе (ревизия 29.1).
    position_hash: Mapped[int] = mapped_column(BigInteger)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)
    ply: Mapped[int] = mapped_column(Integer)
