# --- FILE: src/models/position.py ---
"""
Индекс позиций (таск 16.1): статистика ходов из позиции и партии, через которые позиция проходила. Позиция — хэш
Zobrist (python-chess, 64 бита; в базе — со знаком, чтобы влезть в BIGINT). Глубина индекса — первые
position_index.MAX_PLIES полуходов партии. Сборка — src/services/position_index.py.

Первичные ключи — естественные (ревизия базы 29.1, находка 1; миграция c9a4e7d2f5b8): суррогатного id нет, им никто
не пользовался, а на индекс позиций приходится около двух третей базы. Ключ (position_hash, …) — он же индекс для
поиска по позиции.
"""

from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class PositionStat(Base):
    """
    Статистика одного хода из позиции: сколько партий через него прошло и чем они закончились (победы белых, ничьи,
    победы чёрных). Ключ — (позиция, ход).
    """
    __tablename__ = "position_stats"

    position_hash: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    move_uci: Mapped[str] = mapped_column(String(5), primary_key=True)
    white_wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    draws: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    black_wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PositionGame(Base):
    """
    Партия, прошедшая через позицию: один раз на партию, даже если позиция повторялась (ply — первый полуход, на
    котором она встретилась). Ключ — (позиция, партия).
    """
    __tablename__ = "position_games"

    position_hash: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), primary_key=True, index=True)
    ply: Mapped[int] = mapped_column(Integer)
