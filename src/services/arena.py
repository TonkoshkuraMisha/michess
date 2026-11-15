# --- FILE: src/services/arena.py ---
"""
Арены (таск 17.2): турниры между людьми по времени. Правила:

* расписание: арены по SCHEDULE создаются заранее на LOOKAHEAD вперёд (лениво — при запросе списка);
* вход — пока арена не кончилась; «Играть» ставит игрока в ожидание (Redis), пара — с другим ожидающим, ближайшим
  по очкам и рейтингу, по возможности не с прошлым соперником; партия — обычная рейтинговая PvP-партия
  (matchmaker.start_pvp_game), цвета — тому, кто реже играл белыми;
* очки: победа 2, ничья 1, поражение 0; с FIRE_AFTER побед подряд («огонь») — вдвое; серию рвёт ничья или поражение;
* после конца новые пары не создаются, начатые партии доигрываются и засчитываются.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.db import redis as redis_module
from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.user import User
from src.services.rating import classify_time_control

FIRE_AFTER = 2
LOOKAHEAD = timedelta(hours=6)
WAIT_TTL_S = 120


@dataclass(frozen=True)
class Slot:
    key: str
    base_time_ms: int
    increment_ms: int
    every: timedelta
    duration: timedelta


SCHEDULE = (
    Slot("bullet-1+0", 60_000, 0, timedelta(hours=2), timedelta(minutes=30)),
    Slot("blitz-3+2", 180_000, 2_000, timedelta(hours=1), timedelta(minutes=45)),
    Slot("rapid-10+0", 600_000, 0, timedelta(hours=3), timedelta(minutes=60)),
)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def status(arena: Arena, now: datetime | None = None) -> str:
    now = now or _now()
    if now < _aware(arena.starts_at):
        return "scheduled"
    return "running" if now < _aware(arena.ends_at) else "finished"


async def ensure_schedule(db: AsyncSession, now: datetime | None = None) -> None:
    """Создаёт арены расписания, которые начнутся в ближайшие LOOKAHEAD (каждая — один раз)."""
    now = now or _now()
    epoch = datetime(2026, 1, 1, tzinfo=UTC)
    for slot in SCHEDULE:
        step = int((now - epoch) / slot.every)
        start = epoch + slot.every * step
        while start < now + LOOKAHEAD:
            if start + slot.duration > now:
                exists = await db.scalar(select(Arena.id).where(Arena.schedule_key == slot.key, Arena.starts_at == start))
                if exists is None:
                    db.add(Arena(schedule_key=slot.key, base_time_ms=slot.base_time_ms, increment_ms=slot.increment_ms,
                                 starts_at=start, ends_at=start + slot.duration))
            start += slot.every
    await db.commit()


def points(result_for_player: float, streak_before: int) -> int:
    """Очки за партию: победа 2, ничья 1; на «огне» (FIRE_AFTER побед подряд) — вдвое."""
    base = {1.0: 2, 0.5: 1, 0.0: 0}[result_for_player]
    return base * 2 if streak_before >= FIRE_AFTER else base


async def _player(db: AsyncSession, arena_id: int, user_id: int) -> ArenaPlayer | None:
    return (await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == arena_id, ArenaPlayer.user_id == user_id)
    )).scalar_one_or_none()


async def get(db: AsyncSession, arena_id: int) -> Arena:
    arena = await db.get(Arena, arena_id)
    if arena is None:
        raise DomainError("arena_not_found")
    return arena


async def join(db: AsyncSession, arena: Arena, user: User) -> ArenaPlayer:
    if status(arena) == "finished":
        raise DomainError("arena_finished")
    existing = await _player(db, arena.id, user.id)
    if existing:
        return existing
    category = classify_time_control(arena.base_time_ms, arena.increment_ms)
    player = ArenaPlayer(arena_id=arena.id, user_id=user.id, rating=user.rating_for(category))
    db.add(player)
    await db.commit()
    await db.refresh(player)
    return player


def _wait_key(arena_id: int) -> str:
    return f"arena:{arena_id}:waiting"


async def leave_waiting(arena_id: int, user_id: int) -> None:
    await redis_module.redis_client.hdel(_wait_key(arena_id), str(user_id))


async def waiting_ids(arena_id: int) -> set[int]:
    raw = await redis_module.redis_client.hgetall(_wait_key(arena_id))
    now = _now().timestamp()
    alive = {int(uid) for uid, since in raw.items() if now - float(since) < WAIT_TTL_S}
    stale = [uid for uid in raw if int(uid) not in alive]
    if stale:
        await redis_module.redis_client.hdel(_wait_key(arena_id), *stale)
    return alive


async def _last_opponent(db: AsyncSession, arena_id: int, user_id: int) -> int | None:
    row = (await db.execute(
        select(ArenaGame.white_id, ArenaGame.black_id)
        .where(ArenaGame.arena_id == arena_id, (ArenaGame.white_id == user_id) | (ArenaGame.black_id == user_id))
        .order_by(ArenaGame.id.desc()).limit(1)
    )).first()
    if row is None:
        return None
    return row[1] if row[0] == user_id else row[0]


async def _whites(db: AsyncSession, arena_id: int, user_id: int) -> int:
    return await db.scalar(select(func.count()).select_from(ArenaGame).where(
        ArenaGame.arena_id == arena_id, ArenaGame.white_id == user_id)) or 0


async def ready(db: AsyncSession, arena: Arena, user: User) -> dict:
    """
    «Играть»: игрок ждёт пару. Если ждёт ещё кто-то — сразу пара и партия; иначе игрок остаётся в ожидании
    (клиент повторяет запрос, пока не начнётся партия). Возвращает {"game_id": …} или {"waiting": true}.
    """
    from src.services.connection_manager import manager
    from src.services.matchmaker import matchmaker

    if status(arena) != "running":
        raise DomainError("arena_not_running")
    me = await _player(db, arena.id, user.id)
    if me is None:
        raise DomainError("arena_not_joined")
    await redis_module.redis_client.hset(_wait_key(arena.id), mapping={str(user.id): str(_now().timestamp())})
    others = [uid for uid in await waiting_ids(arena.id) if uid != user.id]
    if not others:
        return {"waiting": True}
    players = {p.user_id: p for p in (await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == arena.id, ArenaPlayer.user_id.in_(others))
    )).scalars()}
    last = await _last_opponent(db, arena.id, user.id)

    def distance(uid: int) -> tuple[int, int, int]:
        other = players.get(uid)
        if other is None:
            return (2, 0, 0)
        return (int(uid == last), abs(other.score - me.score), abs(other.rating - me.rating))

    opponent_id = min(others, key=distance)
    white, black = (user.id, opponent_id)
    if await _whites(db, arena.id, user.id) > await _whites(db, arena.id, opponent_id):
        white, black = black, white
    await leave_waiting(arena.id, user.id)
    await leave_waiting(arena.id, opponent_id)
    started = await matchmaker.start_pvp_game(white, black, arena.base_time_ms, arena.increment_ms,
                                              connection_manager=manager, db=db, initiator_id=user.id, is_rated=True)
    db.add(ArenaGame(arena_id=arena.id, game_id=started["game_id"], white_id=white, black_id=black))
    await db.commit()
    return {"game_id": started["game_id"]}


async def on_game_finished(db: AsyncSession, game_id: int, result: str) -> bool:
    """Партия арены закончилась: очки, серии, счётчики (без commit). False — это не партия арены."""
    game = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    if game is None or game.result is not None:
        return False
    white_score = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
    game.result = result
    sides = ((game.white_id, white_score, "white_points"), (game.black_id, 1.0 - white_score, "black_points"))
    for user_id, score, field in sides:
        player = await _player(db, game.arena_id, user_id)
        if player is None:
            continue
        earned = points(score, player.streak)
        setattr(game, field, earned)
        player.score += earned
        player.games += 1
        if score == 1.0:
            player.wins += 1
            player.streak += 1
        else:
            player.streak = 0
    return True


async def standings(db: AsyncSession, arena_id: int) -> list[dict]:
    rows = (await db.execute(
        select(ArenaPlayer, User.username).join(User, User.id == ArenaPlayer.user_id)
        .where(ArenaPlayer.arena_id == arena_id)
        .order_by(ArenaPlayer.score.desc(), ArenaPlayer.wins.desc(), ArenaPlayer.rating.desc(), ArenaPlayer.joined_at)
    )).all()
    return [{"place": i + 1, "username": name, "score": p.score, "games": p.games, "wins": p.wins,
             "fire": p.streak >= FIRE_AFTER, "rating": p.rating} for i, (p, name) in enumerate(rows)]


def view(arena: Arena, now: datetime | None = None) -> dict:
    return {"id": arena.id, "schedule_key": arena.schedule_key, "base_time_ms": arena.base_time_ms,
            "increment_ms": arena.increment_ms, "starts_at": _aware(arena.starts_at).isoformat(),
            "ends_at": _aware(arena.ends_at).isoformat(), "status": status(arena, now)}


async def current_game(db: AsyncSession, arena_id: int, user_id: int) -> int | None:
    """Идущая партия игрока в этой арене (для перехода на доску из ожидания)."""
    row = await db.scalar(
        select(ArenaGame.game_id).where(
            ArenaGame.arena_id == arena_id, ArenaGame.result.is_(None),
            (ArenaGame.white_id == user_id) | (ArenaGame.black_id == user_id),
        ).order_by(ArenaGame.id.desc()).limit(1)
    )
    return row

