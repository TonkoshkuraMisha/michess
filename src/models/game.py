# --- FILE: src/models/game.py ---
"""
Партия (таблица games) — общая для всех видов игры: с человеком, с ботом, архив мастеров, симуляция турнира.

Кто пишет: старт партии с человеком — src/services/matchmaker.py; ходы и часы по ходу игры и итог —
src/services/game_state.py (источник правды во время партии — Redis, сюда состояние копируется); партия с ботом
целиком после окончания — src/api/bots.py (save-game); архив — src/db/seed.py; партии ботов между собой —
src/services/tournament_simulation.py (is_simulation).

Главные поля: pgn — запись ходов; board_fen, turn, часы и state_version — состояние идущей партии (по ним оно
восстанавливается, если пропало из Redis); result и termination — итог и его причина; рейтинги игроков на начало
и изменение после партии; analysis_json — сохранённый разбор движком; positions_indexed — партия уже разложена в
индекс позиций.
"""

import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base


class GameStatus(str, enum.Enum):
    """
    Статус партии: PENDING — создана, ещё не началась; IN_PROGRESS — идёт; COMPLETED — закончена с результатом;
    ABORTED — отменена до первых ходов, рейтинг не меняется.
    """
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"


class Game(Base):
    """Одна партия любого вида. Что в каких полях и кто их пишет — в описании модуля выше."""
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    white_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    black_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    pgn: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[GameStatus] = mapped_column(
        Enum(GameStatus, name="gamestatus"),
        default=GameStatus.PENDING,
        nullable=False,
        index=True,
    )

    base_time_ms: Mapped[int] = mapped_column(Integer, default=180000, server_default="180000", nullable=False)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_rated: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    state_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    turn: Mapped[str] = mapped_column(String(1), default="w", server_default="w", nullable=False)
    # Начальная позиция партии с форой (21.1, сеть); None — обычная расстановка.
    initial_fen: Mapped[str | None] = mapped_column(String(100), nullable=True)
    board_fen: Mapped[str] = mapped_column(
        String,
        default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        server_default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        nullable=False,
    )

    white_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_move_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    termination: Mapped[str | None] = mapped_column(String(50), nullable=True)
    winner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    white_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    white_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    pgn_date: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    site: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    eco: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)

    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Имя персоналии из мастерской соперников: в базе соперник — общий бот-пользователь,
    # в архиве и PGN показывается имя, которое дал ему игрок.
    personality_name: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Партия ботов между собой, сыгранная сервером в турнире (таск 15.2): без рейтинга, не в архиве и статистике
    # профилей, открывается по ссылке из турнира.
    is_simulation: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Партия разложена в индекс позиций (таск 16.1, src/services/position_index.py) — повторно не считается.
    positions_indexed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Учебная партия (правило 2 Части II): игрок пользовался наставником — советами или проверкой ходов.
    # Без рейтинга (партии с ботами и так без рейтинга), в архиве помечается.
    assisted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Игра вслепую (таск 19.5): ступень 1–4 (свои фигуры видны → исчезают → только пешки → полностью) и число
    # подсмотров; null — обычная партия. Только нерейтинговые партии.
    blindfold_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blindfold_peeks: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    white_player = relationship("User", foreign_keys=[white_player_id])
    black_player = relationship("User", foreign_keys=[black_player_id])
    moves = relationship("Move", cascade="all, delete-orphan")
