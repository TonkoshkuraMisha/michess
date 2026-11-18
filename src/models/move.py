# --- FILE: src/models/move.py ---
"""
Ход партии с телеметрией (таблица moves): время на ход по часам сервера, потеря фокуса окна, предход, задержка
сети. Пишется при завершении партии между людьми из журнала ходов в Redis (src/services/game_state.finish_game) и
читается античитом (src/services/anticheat.py). Сами ходы для просмотра берутся из games.pgn, не отсюда.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.models.base import Base


class Move(Base):
    """
    Один ход партии между людьми с телеметрией для античита. Строки появляются разом при завершении партии; у
    партий с ботами, архивных и симуляций записей в этой таблице нет.
    """
    __tablename__ = "moves"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="RESTRICT"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)

    # Номер хода партии (fullmove, как в записи «12. Nf3»): у хода белых и ответа чёрных он одинаковый. Это не номер
    # полухода — его записывает src/api/websockets._record_applied_move из move_data["fullmove_number"].
    move_number: Mapped[int] = mapped_column(Integer)

    # --- Ход ---
    notation: Mapped[str] = mapped_column(String(10))  # Универсальный UCI (e.g., e2e4)
    san: Mapped[str | None] = mapped_column(String(10), nullable=True)  # Для красивого отображения (e.g., Nf3)
    fen_after: Mapped[str | None] = mapped_column(String, nullable=True)  # Состояние доски ПОСЛЕ хода
    # ------------------

    # --- Телеметрия ---
    # Время на ход по часам сервера (от предыдущего хода до прихода этого) — не то, что назвал клиент.
    time_taken_ms: Mapped[int] = mapped_column(Integer)
    # Окно теряло фокус перед ходом — со слов клиента (подделывается, поэтому само по себе не штрафует).
    window_blurred_before_move: Mapped[bool] = mapped_column(Boolean, default=False)
    # Предход: флаг клиента, принятый сервером, только если ход пришёл почти мгновенно (anticheat.trusted_premove).
    is_premove: Mapped[bool] = mapped_column(Boolean, default=False)
    # Время сервера минус время обдумывания, названное клиентом (не меньше нуля): оценка задержки сети.
    network_lag_ms: Mapped[int] = mapped_column(Integer, default=0)

    # Момент вставки строки в базу, то есть завершения партии, а не момент самого хода.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
