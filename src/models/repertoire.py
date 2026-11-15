"""
Дебютный репертуар (таск 20.1): свои линии за белых или за чёрных. Репертуар хранится как граф позиций: ход
`move_uci` из позиции `position` (EPD — четыре поля FEN, как в таблице дебютов src/services/openings.py), поэтому
перестановки ходов сходятся в одну позицию. Дерево для клиента собирает src/services/repertoire.py обходом от
начальной позиции.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Repertoire(Base):
    __tablename__ = "repertoires"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    color: Mapped[str] = mapped_column(String(5))  # white | black
    # Из какого стартового репертуара создан (None — свой с нуля): клиент показывает вводный текст.
    starter: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RepertoireMove(Base):
    __tablename__ = "repertoire_moves"
    __table_args__ = (UniqueConstraint("repertoire_id", "position", "move_uci", name="uq_repertoire_move"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    repertoire_id: Mapped[int] = mapped_column(ForeignKey("repertoires.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(100))
    move_uci: Mapped[str] = mapped_column(String(5))
    comment: Mapped[str] = mapped_column(String(300), default="", server_default="")
