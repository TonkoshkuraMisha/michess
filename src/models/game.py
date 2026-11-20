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

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, one_of

# Итог партии (CHECK ck_games_result; тот же набор — game_engine.GAME_RESULTS, сверка — tests/test_db_integrity.py).
# NULL — партия ещё не закончена.
GAME_RESULTS = ("1-0", "0-1", "1/2-1/2", "*")


class GameStatus(str, enum.Enum):
    """
    Статус партии: PENDING — значение по умолчанию (партия между людьми создаётся сразу IN_PROGRESS);
    IN_PROGRESS — идёт; COMPLETED — закончена с результатом; ABORTED — отменена, пока сделано меньше двух
    полуходов (игроком или из-за неявки на первый ход), рейтинг не меняется. ABORTED получает и запись-заглушка
    тура швейцарки, когда партию не удалось начать (src/services/arena.py).
    """
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"


class Game(Base):
    """Одна партия любого вида. Что в каких полях и кто их пишет — в описании модуля выше."""
    __tablename__ = "games"
    __table_args__ = (one_of("games", "result", GAME_RESULTS),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # RESTRICT — осознанное решение (ревизия базы 29.1, находка 5): игрока с партиями не удаляют, аккаунт
    # обезличивается (src/services/account.py), а партии остаются у соперника и в статистике. То же у winner_id и moves.
    white_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
                                                 index=True)
    black_player_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
                                                 index=True)

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
    # «Песочные часы» (фора, 21.1): время, потраченное ходящим, прибавляется сопернику (src/services/game_state.py).
    hourglass: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    state_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    turn: Mapped[str] = mapped_column(String(1), default="w", server_default="w", nullable=False)
    # Начальная позиция партии между людьми, начатой не с обычной расстановки: фора (21.1) или шахматы Фишера;
    # None — обычная расстановка. У партии с ботом своя позиция записана в заголовках SetUp/FEN её PGN.
    initial_fen: Mapped[str | None] = mapped_column(String(100), nullable=True)
    board_fen: Mapped[str] = mapped_column(
        String,
        default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        server_default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        nullable=False,
    )

    # Часы: остаток времени сторон на момент последнего хода и время этого хода по часам сервера (миллисекунды
    # эпохи Unix). Остаток у стороны, которая думает сейчас, = её значение минус время, прошедшее с last_move_at.
    white_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_move_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    termination: Mapped[str | None] = mapped_column(String(50), nullable=True)
    winner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True,
                                                  index=True)

    # Рейтинги игроков в категории партии на её начало и изменение после неё — по ним строится история рейтинга
    # (GET /profile/{username}/rating-history). У товарищеской и отменённой партии между людьми изменение — 0;
    # у архивных партий и партий с ботами вне турниров поля изменения пусты.
    white_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_initial_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    white_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_rating_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Дата («ГГГГ.ММ.ДД», как в PGN), место и код дебюта: у архивных партий — из заголовков PGN, у сыгранных на
    # сайте — дата окончания, название сайта и код из таблицы дебютов (src/services/openings.py).
    pgn_date: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    site: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    eco: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)

    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Сводка телеметрии ходов по сторонам (src/services/anticheat.telemetry_summary): ритм, потеря фокуса, предходы,
    # штраф. Пишется при оценке партии античитом или перед удалением сырых ходов из moves через RETENTION_DAYS
    # (src/services/telemetry_retention.py) — после этого ходы партии остаются только здесь.
    telemetry_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
