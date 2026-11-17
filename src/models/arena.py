# --- FILE: src/models/arena.py ---
"""
Арены — турниры между людьми (таск 17.2): идут заданное время, игроки играют партию за партией с теми, кто тоже ждёт;
очки за партию, серия побед удваивает очки («огонь»). Правила — src/services/arena.py.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, false, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Arena(Base):
    __tablename__ = "arenas"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Код расписания (например, «blitz-3+2»), чтобы не создавать одну и ту же арену дважды; пусто — разовая арена.
    schedule_key: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    base_time_ms: Mapped[int] = mapped_column(Integer)
    increment_ms: Mapped[int] = mapped_column(Integer, default=0)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    # arena — играешь, пока идёт время; swiss — заданное число туров, пары по очкам (src/services/arena.py).
    format: Mapped[str] = mapped_column(String(16), default="arena", server_default="arena")
    rounds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    current_round: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Швейцарка закончена (все туры сыграны или участников не хватило) — момент окончания.
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Группа по силе (таск 33.2): потолок рейтинга в контроле арены на входе (и пика за неделю); пусто — открытая.
    max_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Деления при переполнении (33.2): второе и дальше — арены с parent_id первой: те же время и правила, своя таблица.
    division: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), nullable=True, index=True)
    # Конференция, по расписанию которой идёт арена (33.4, src/services/arena_schedule.py); пусто — разовая арена.
    conference: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArenaPlayer(Base):
    __tablename__ = "arena_players"
    __table_args__ = (UniqueConstraint("arena_id", "user_id", name="uq_arena_player"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    arena_id: Mapped[int] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    games: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    wins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Побед подряд: с ARENA_FIRE_AFTER и дальше партия приносит вдвое больше очков.
    streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Рейтинг в категории арены на момент входа — для пар и таблицы.
    rating: Mapped[int] = mapped_column(Integer)
    # Швейцарка: свободных туров при нечётном числе игроков (каждому — не больше одного).
    byes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Конференция игрока на момент входа (33.6): его очки идут в её зачёт; пусто — страна в профиле не указана.
    conference: Mapped[str | None] = mapped_column(String(16), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArenaReminder(Base):
    """Напоминание о начале арены (33.4): игрок нажал «напомнить» — незадолго до старта придёт уведомление."""
    __tablename__ = "arena_reminders"
    __table_args__ = (UniqueConstraint("arena_id", "user_id", name="uq_arena_reminder"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    arena_id: Mapped[int] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Момент отправки уведомления; пусто — ещё не отправлено.
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ArenaGame(Base):
    __tablename__ = "arena_games"

    id: Mapped[int] = mapped_column(primary_key=True)
    arena_id: Mapped[int] = mapped_column(ForeignKey("arenas.id", ondelete="CASCADE"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), unique=True)
    white_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    black_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    result: Mapped[str | None] = mapped_column(String(8), nullable=True)
    white_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # «Берсерк» (33.3): сторона до своего первого хода взяла половину времени без добавки — победа даёт лишнее очко.
    white_berserk: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    black_berserk: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Тур швейцарки (у арены — 0).
    round: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
