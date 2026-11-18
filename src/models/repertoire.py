"""
Дебютный репертуар (таск 20.1): свои линии за белых или за чёрных. Репертуар хранится как граф позиций: ход
`move_uci` из позиции `position` (EPD — четыре поля FEN, как в таблице дебютов src/services/openings.py), поэтому
перестановки ходов сходятся в одну позицию. Дерево для клиента собирает src/services/repertoire.py обходом от
начальной позиции.
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, one_of

# Цвет репертуара.
REPERTOIRE_COLORS = ("white", "black")


class Repertoire(Base):
    """Репертуар игрока: название и цвет, за который он составлен."""
    __tablename__ = "repertoires"
    __table_args__ = (one_of("repertoires", "color", REPERTOIRE_COLORS),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(5))  # white | black
    # Из какого стартового репертуара создан (None — свой с нуля): клиент показывает вводный текст.
    starter: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RepertoireMove(Base):
    """
    Ход репертуара — ребро графа позиций: из позиции (EPD) делается ход. Перестановки ходов приходят в одну и ту же
    позицию.
    """
    __tablename__ = "repertoire_moves"
    __table_args__ = (UniqueConstraint("repertoire_id", "position", "move_uci", name="uq_repertoire_move"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    repertoire_id: Mapped[int] = mapped_column(ForeignKey("repertoires.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(100))
    move_uci: Mapped[str] = mapped_column(String(5))
    comment: Mapped[str] = mapped_column(String(300), default="", server_default="")


class RepertoireCard(Base):
    """
    Карточка повторения (таск 20.2): позиция репертуара, где ход за игроком, — «найди свой ход». Расписание по SM-2:
    лёгкость, интервал в днях, число верных ответов подряд, срок следующего показа.
    """

    __tablename__ = "repertoire_cards"
    __table_args__ = (UniqueConstraint("repertoire_id", "position", name="uq_repertoire_card"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    repertoire_id: Mapped[int] = mapped_column(ForeignKey("repertoires.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(100))
    ease: Mapped[float] = mapped_column(Float, default=2.5, server_default="2.5")
    interval_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    repetitions: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    first_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
