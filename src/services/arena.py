# --- FILE: src/services/arena.py ---
"""
Арены (таск 17.2): турниры между людьми по времени. Правила:

* расписание: арены по SCHEDULE создаются заранее на LOOKAHEAD вперёд (лениво — при запросе списка);
* вход — пока арена не кончилась; «Играть» ставит игрока в ожидание (Redis), пара — с другим ожидающим, ближайшим
  по очкам и рейтингу, по возможности не с прошлым соперником; партия — обычная рейтинговая PvP-партия
  (matchmaker.start_pvp_game), цвета — тому, кто реже играл белыми;
* очки: победа 2, ничья 1, поражение 0; с FIRE_AFTER побед подряд («огонь») — вдвое; серию рвёт ничья или поражение;
* честный конец (таск 33.1, docs/research/arenas.md): новые пары — только до «последнего старта» (конец минус
  длительность партии: 2 × (база + GAME_MOVES × добавка)); итоги — когда закончилась последняя партия (до этого
  статус closing); каждая сыгранная партия засчитывается;
* неявка: первый ход не сделан и партия отменена по таймауту — поражение тому, чья очередь ходить, сопернику —
  победа; добровольная отмена в арене запрещена; договорная ничья до EARLY_DRAW_PLIES полуходов — 0 очков обоим;
* таблица при равенстве очков: перформанс в арене, затем меньше партий, затем раньше вошедший.

Швейцарка между людьми (format="swiss"): заданное число туров; тур составляется по правилам швейцарки
(tournament_rules.swiss_pairings, посев — по рейтингу на входе), партии всех пар создаются сразу (неявка — поражение по
времени), при нечётном числе — свободный тур слабейшему без свободного тура (очки за победу); следующий тур — когда
сыграны все партии текущего; «огня» нет. Ход турнира продвигается при каждом завершении партии и при запросе страницы.
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
GAME_MOVES = 40
EARLY_DRAW_PLIES = 20
LOOKAHEAD = timedelta(hours=6)
WAIT_TTL_S = 120


@dataclass(frozen=True)
class Slot:
    key: str
    base_time_ms: int
    increment_ms: int
    every: timedelta
    duration: timedelta
    format: str = "arena"
    rounds: int = 0


SCHEDULE = (
    Slot("bullet-1+0", 60_000, 0, timedelta(hours=2), timedelta(minutes=30)),
    Slot("blitz-3+2", 180_000, 2_000, timedelta(hours=1), timedelta(minutes=45)),
    Slot("rapid-10+0", 600_000, 0, timedelta(hours=3), timedelta(minutes=60)),
    Slot("swiss-rapid-10+5", 600_000, 5_000, timedelta(hours=12), timedelta(hours=3), "swiss", 5),
)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def game_length(arena: Arena) -> timedelta:
    """Сколько длится партия контроля арены: оба игрока тратят базу и добавку на GAME_MOVES ходов."""
    return timedelta(milliseconds=2 * (arena.base_time_ms + GAME_MOVES * arena.increment_ms))


def last_start(arena: Arena) -> datetime:
    """Последний момент, когда арена ещё создаёт пары: партия успевает закончиться к объявленному концу."""
    return max(_aware(arena.starts_at), _aware(arena.ends_at) - game_length(arena))


def pairing_open(arena: Arena, now: datetime | None = None) -> bool:
    now = now or _now()
    return (arena.format or "arena") == "arena" and _aware(arena.starts_at) <= now < last_start(arena)


def status(arena: Arena, now: datetime | None = None, open_games: int = 0) -> str:
    """
    scheduled → running (пары создаются) → closing (пар больше нет: доигрываются партии или идёт время до конца) →
    finished (конец наступил и все партии сыграны — итоги окончательные).
    """
    now = now or _now()
    if now < _aware(arena.starts_at):
        return "scheduled"
    if arena.format == "swiss":
        return "finished" if arena.finished_at is not None else "running"
    if now < last_start(arena):
        return "running"
    return "closing" if open_games > 0 or now < _aware(arena.ends_at) else "finished"


async def open_games(db: AsyncSession, arena_id: int) -> int:
    return await db.scalar(select(func.count()).select_from(ArenaGame).where(
        ArenaGame.arena_id == arena_id, ArenaGame.result.is_(None))) or 0


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
                                 starts_at=start, ends_at=start + slot.duration, format=slot.format, rounds=slot.rounds))
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

    now = _now()
    if arena.format != "arena" or now < _aware(arena.starts_at) or now >= _aware(arena.ends_at):
        raise DomainError("arena_not_running")
    if not pairing_open(arena, now):
        raise DomainError("arena_pairing_closed")
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


async def is_arena_game(db: AsyncSession, game_id: int) -> bool:
    return await db.scalar(select(ArenaGame.id).where(ArenaGame.game_id == game_id)) is not None


async def on_game_aborted(db: AsyncSession, game_id: int, no_show: str | None) -> bool:
    """
    Партия арены отменена до первых ходов (без commit). no_show — сторона, не сделавшая первый ход: ей поражение,
    сопернику победа с очками. None (сторона неизвестна, например сверка после сбоя) — партия закрыта без очков, чтобы
    итоги арены не ждали её вечно.
    """
    if no_show in ("white", "black"):
        return await on_game_finished(db, game_id, "0-1" if no_show == "white" else "1-0")
    game = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    if game is None or game.result is not None:
        return False
    game.result, game.white_points, game.black_points = "*", 0, 0
    return True


async def on_game_finished(db: AsyncSession, game_id: int, result: str, termination: str | None = None,
                           plies: int | None = None) -> bool:
    """Партия арены закончилась: очки, серии, счётчики (без commit). False — это не партия арены."""
    game = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    if game is None or game.result is not None:
        return False
    white_score = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
    # Договорная ничья в самом начале очков не приносит (и рвёт серию): таблица — за сыгранные партии.
    early_draw = result == "1/2-1/2" and termination == "agreement" and plies is not None and plies < EARLY_DRAW_PLIES
    game.result = result
    sides = ((game.white_id, white_score, "white_points"), (game.black_id, 1.0 - white_score, "black_points"))
    arena = await db.get(Arena, game.arena_id)
    swiss = arena is not None and arena.format == "swiss"
    for user_id, score, field in sides:
        player = await _player(db, game.arena_id, user_id)
        if player is None:
            continue
        # Правило ранней ничьей — для арены (в швейцарке тур есть тур, ничья в нём считается как обычно).
        earned = 0 if early_draw and not swiss else points(score, 0 if swiss else player.streak)
        setattr(game, field, earned)
        player.score += earned
        player.games += 1
        if score == 1.0:
            player.wins += 1
            player.streak += 1
        else:
            player.streak = 0
    return True


async def advance_after_game(db: AsyncSession, game_id: int) -> None:
    """
    После полного завершения партии (её состояние уже очищено — игроки свободны) — следующий тур швейцарки. Вызывать
    из game_state после clear_game_state: раньше новая пара не начнётся («игрок уже в партии»).
    """
    record = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    if record is None:
        return
    arena = await db.get(Arena, record.arena_id)
    if arena is None or arena.format != "swiss":
        return
    await db.refresh(arena)
    await advance_swiss(db, arena)
    await db.commit()


# --- Швейцарка между людьми -------------------------------------------------------------------------------

async def advance_swiss(db: AsyncSession, arena: Arena, now: datetime | None = None) -> None:
    """
    Продвигает швейцарку (без commit): после начала — первый тур; тур сыгран — следующий или конец. Меньше двух
    участников на старте — турнир окончен без партий.
    """
    from src.services import tournament_rules as rules

    now = now or _now()
    if arena.format != "swiss" or arena.finished_at is not None or now < _aware(arena.starts_at):
        return
    games = list((await db.execute(select(ArenaGame).where(ArenaGame.arena_id == arena.id))).scalars())
    if any(g.result is None for g in games if g.round == arena.current_round):
        return
    players = list((await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == arena.id)
        .order_by(ArenaPlayer.rating.desc(), ArenaPlayer.joined_at, ArenaPlayer.id)
    )).scalars())
    if arena.current_round >= arena.rounds or len(players) < 2:
        arena.finished_at = now
        return
    arena.current_round += 1
    seat_of = {p.user_id: i + 1 for i, p in enumerate(players)}
    user_of = {seat: uid for uid, seat in seat_of.items()}
    pairable = list(players)
    if len(pairable) % 2:
        # Свободный тур — слабейшему по очкам из тех, у кого его ещё не было.
        bye = min((p for p in pairable if p.byes == 0), key=lambda p: (p.score, -seat_of[p.user_id]), default=pairable[-1])
        bye.byes += 1
        bye.score += points(1.0, 0)
        bye.games += 1
        pairable.remove(bye)
    seats = [seat_of[p.user_id] for p in pairable]
    records = [rules.GameRecord(seat_of[g.white_id], seat_of[g.black_id], g.result)  # type: ignore[arg-type]
               for g in games if g.result and g.white_id in seat_of and g.black_id in seat_of
               and seat_of[g.white_id] in seats and seat_of[g.black_id] in seats]
    for white_seat, black_seat in rules.swiss_pairings(seats, records):
        await _start_swiss_game(db, arena, user_of[white_seat], user_of[black_seat])


async def _start_swiss_game(db: AsyncSession, arena: Arena, white: int, black: int) -> None:
    """Партия тура; начать не удалось (кто-то из пары занят другой партией) — ничья без игры, чтобы тур не встал."""
    from src.models.game import Game, GameStatus
    from src.services.connection_manager import manager
    from src.services.matchmaker import MatchmakingError, matchmaker

    try:
        started = await matchmaker.start_pvp_game(white, black, arena.base_time_ms, arena.increment_ms,
                                                  connection_manager=manager, db=db, is_rated=True)
        db.add(ArenaGame(arena_id=arena.id, game_id=started["game_id"], white_id=white, black_id=black,
                         round=arena.current_round))
        await db.flush()
    except MatchmakingError:
        game = Game(white_player_id=white, black_player_id=black, status=GameStatus.ABORTED, is_rated=False)
        db.add(game)
        await db.flush()
        record = ArenaGame(arena_id=arena.id, game_id=game.id, white_id=white, black_id=black, round=arena.current_round)
        db.add(record)
        await db.flush()
        record.result = "1/2-1/2"
        for user_id in (white, black):
            player = await _player(db, arena.id, user_id)
            if player is not None:
                player.games += 1
                player.score += points(0.5, 0)
        record.white_points = record.black_points = points(0.5, 0)


def performance(results: list[tuple[int, float]]) -> int | None:
    """Перформанс: средний рейтинг соперников ± 400 × (победы − поражения) / партии; без партий — None."""
    if not results:
        return None
    total = sum(rating for rating, _ in results)
    balance = sum(1 if score == 1.0 else -1 if score == 0.0 else 0 for _, score in results)
    return round((total + 400 * balance) / len(results))


async def standings(db: AsyncSession, arena_id: int) -> list[dict]:
    """
    Таблица: очки; при равенстве — перформанс в арене, затем меньше партий (те же очки быстрее), затем раньше
    вошедший. Партии, закрытые без очков («*»), в перформанс не идут.
    """
    rows = (await db.execute(
        select(ArenaPlayer, User.username).join(User, User.id == ArenaPlayer.user_id)
        .where(ArenaPlayer.arena_id == arena_id)
    )).all()
    rating_of = {p.user_id: p.rating for p, _ in rows}
    results: dict[int, list[tuple[int, float]]] = {uid: [] for uid in rating_of}
    finished = await db.execute(select(ArenaGame).where(
        ArenaGame.arena_id == arena_id, ArenaGame.result.in_(("1-0", "0-1", "1/2-1/2"))))
    for g in finished.scalars():
        white_score = {"1-0": 1.0, "0-1": 0.0}.get(g.result or "", 0.5)
        if g.white_id in results:
            results[g.white_id].append((rating_of.get(g.black_id, 1500), white_score))
        if g.black_id in results:
            results[g.black_id].append((rating_of.get(g.white_id, 1500), 1.0 - white_score))
    perf = {uid: performance(items) for uid, items in results.items()}

    def key(row) -> tuple:
        p = row[0]
        joined = _aware(p.joined_at) if p.joined_at else _now()
        return (-p.score, -(perf[p.user_id] or 0), p.games, joined)

    ordered = sorted(rows, key=key)
    return [{"place": i + 1, "username": name, "score": p.score, "games": p.games, "wins": p.wins,
             "fire": p.streak >= FIRE_AFTER, "rating": p.rating, "performance": perf[p.user_id]}
            for i, (p, name) in enumerate(ordered)]


def view(arena: Arena, now: datetime | None = None, open_games: int = 0) -> dict:
    out = {"id": arena.id, "schedule_key": arena.schedule_key, "format": arena.format, "rounds": arena.rounds,
           "current_round": arena.current_round, "base_time_ms": arena.base_time_ms,
           "increment_ms": arena.increment_ms, "starts_at": _aware(arena.starts_at).isoformat(),
           "ends_at": _aware(arena.ends_at).isoformat(), "status": status(arena, now, open_games),
           "open_games": open_games}
    if arena.format == "arena":
        out["last_start_at"] = last_start(arena).isoformat()
    return out


async def current_game(db: AsyncSession, arena_id: int, user_id: int) -> int | None:
    """Идущая партия игрока в этой арене (для перехода на доску из ожидания)."""
    row = await db.scalar(
        select(ArenaGame.game_id).where(
            ArenaGame.arena_id == arena_id, ArenaGame.result.is_(None),
            (ArenaGame.white_id == user_id) | (ArenaGame.black_id == user_id),
        ).order_by(ArenaGame.id.desc()).limit(1)
    )
    return row

