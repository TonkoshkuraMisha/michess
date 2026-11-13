# --- FILE: src/models/tournament.py ---
"""
Турниры с историческими мастерами (таск 15.1). Правила — src/services/tournament_rules.py, ход турнира —
src/services/tournaments.py. Номер участника (seat) — его посев: 1 — сильнейший по рейтингу на старте.
Участник — игрок-владелец турнира, исторический бот, архетип мастерской или персоналия игрока (её имя и конфиг
копируются в турнир: удаление или правка персоналии не меняет уже идущий турнир).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # round_robin | knockout
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    # active | finished
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    base_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    increment_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Текущий круг турнира на выбывание (у кругового все туры созданы сразу).
    current_round: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TournamentPlayer(Base):
    __tablename__ = "tournament_players"
    __table_args__ = (UniqueConstraint("tournament_id", "seat", name="uq_tournament_players_seat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    seat: Mapped[int] = mapped_column(Integer, nullable=False)
    # user | bot | archetype | personality
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # id исторического бота («morphy») или ключ архетипа («archetype:rusher»).
    bot_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Персоналия мастерской — копия имени и конфига на момент создания турнира.
    personality_name: Mapped[str | None] = mapped_column(String(30), nullable=True)
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Рейтинг на старте — по нему посев.
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Турнир на выбывание: круг (с 1), в котором участник выбыл.
    eliminated_round: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TournamentGame(Base):
    __tablename__ = "tournament_games"

    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    round: Mapped[int] = mapped_column(Integer, nullable=False)
    # Номер пары в туре (у турнира на выбывание — номер матча в сетке).
    board: Mapped[int] = mapped_column(Integer, nullable=False)
    # main | rematch | armageddon (на выбывание; у кругового всегда main)
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="main")
    white_seat: Mapped[int] = mapped_column(Integer, nullable=False)
    black_seat: Mapped[int] = mapped_column(Integer, nullable=False)
    base_time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    increment_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 1-0 | 0-1 | 1/2-1/2; пусто — партия ещё не сыграна.
    result: Mapped[str | None] = mapped_column(String(8), nullable=True)
    game_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("games.id", ondelete="SET NULL"), nullable=True)
    # Партию ботов между собой забрал воркер (таск 15.2): защищает от двойного счёта одной партии.
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
