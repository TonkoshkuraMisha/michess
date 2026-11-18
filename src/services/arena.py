# --- FILE: src/services/arena.py ---
"""
Арены (таск 17.2): турниры между людьми по времени. Правила:

* расписание — по конференциям (таск 33.4, src/services/arena_schedule.py): арены создаются заранее на LOOKAHEAD
  вперёд (лениво — при запросе списка); пустые будущие арены, которых в расписании больше нет, убираются;
* конференции (33.6, src/services/conferences.py): конференция игрока запоминается при входе в арену, его очки
  идут и в её зачёт (сумма лучших участников конференции);
* напоминание (33.4): игрок нажал «напомнить» у ещё не начавшейся арены — за REMIND_BEFORE до старта ему приходит
  уведомление (плановая задача arena_reminders, раз в минуту);
* вход — до «последнего старта», в том числе до начала (швейцарка — пока не окончена); «Играть» ставит игрока в
  ожидание (Redis, хэш arena:{id}:waiting, отметка живёт WAIT_TTL_S секунд), пара — с другим ожидающим, ближайшим по
  очкам и рейтингу, по возможности не с прошлым соперником; партия — обычная рейтинговая PvP-партия
  (matchmaker.start_pvp_game), белые — тому, кто реже играл белыми в этой арене (при равенстве — нажавшему «Играть»);
* очки: победа 2, ничья 1, поражение 0; с FIRE_AFTER побед подряд («огонь») — вдвое; серию рвёт ничья или поражение;
* честный конец (таск 33.1, docs/research/arenas.md): новые пары — только до «последнего старта» (конец минус
  длительность партии: 2 × (база + GAME_MOVES × добавка)); итоги — когда закончилась последняя партия (до этого
  статус closing); каждая сыгранная партия засчитывается;
* неявка: первый ход не сделан и партия отменена по таймауту — поражение тому, чья очередь ходить, сопернику —
  победа; добровольная отмена в арене запрещена; договорная ничья до EARLY_DRAW_PLIES полуходов — 0 очков обоим;
* таблица при равенстве очков: перформанс в арене, затем меньше партий, затем раньше вошедший;
* вход открыт всем (решение владельца 17.11.2026, CLAUDE.md, правило 7): в любую арену входит любой
  зарегистрированный игрок — без порога сыгранных партий и без арен «только до такого-то рейтинга». Закрыт вход
  только игроку с флагом нечестной игры. Войти можно, пока арена не закрыта для пар (scheduled / running);
* деления: в делении не больше DIVISION_SIZE участников; следующий входящий попадает в первое неполное деление
  той же арены (своя таблица, те же время и правила), а если таких нет — в новое;
* «берсерк» (таск 33.3): до своего первого хода игрок берёт половину базового времени без добавки; победа приносит
  BERSERK_BONUS сверх обычных очков (после удвоения «огня»). Недоступен в самой быстрой пуле без добавки (база не
  больше BERSERK_MIN_BASE_MS — там это лотерея) и в швейцарке; за победу по неявке соперника бонуса нет.

Швейцарка между людьми (format="swiss"): заданное число туров; тур составляется по правилам швейцарки
(tournament_rules.swiss_pairings, посев — по рейтингу на входе), партии всех пар создаются сразу (неявка — поражение по
времени), при нечётном числе — свободный тур слабейшему без свободного тура (очки за победу); следующий тур — когда
сыграны все партии текущего; «огня» нет. Ход турнира продвигается при каждом завершении партии и при запросе страницы.

Матч конференций (format="match", правила — src/services/conference_match_rules.py): хозяин — conference, гость —
opponent_conference; записаться может только игрок одной из двух конференций и только до закрытия записи. На старте
стороны выстраиваются по рейтингу на входе (arena_players.board), два тура идут тем же порядком, что у швейцарки:
партии всех досок создаются сразу, следующий тур — когда сыгран текущий. Очки — как в швейцарке (без «огня», ранней
ничьей и берсерка); счёт матча — match_view. Кубков за матч нет (src/services/arena_awards.py).
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.db import redis as redis_module
from src.models.arena import Arena, ArenaGame, ArenaPlayer, ArenaReminder
from src.models.user import User
from src.services import arena_schedule
from src.services import conference_match_rules as match_rules
from src.services.rating import classify_time_control

# После стольких побед подряд очки за следующие партии удваиваются («огонь»).
FIRE_AFTER = 2
# Оценка длины партии в ходах: по ней считается длительность партии и «последний старт» арены (game_length).
GAME_MOVES = 40
# Предел участников одного деления; следующий входящий открывает новое деление той же арены.
DIVISION_SIZE = 500
# Ничья по соглашению раньше этого числа полуходов (20 — это 10 ходов) очков в арене не приносит.
EARLY_DRAW_PLIES = 20
# Сколько очков добавляет победа с «берсерком».
BERSERK_BONUS = 1
# «Берсерк» без добавки доступен только при базе больше этой (минута): в контроле 1+0 его нет.
BERSERK_MIN_BASE_MS = 60_000
# На сколько вперёд создаются арены расписания (ensure_schedule).
LOOKAHEAD = timedelta(hours=6)
# За сколько до начала арены приходит напоминание (send_reminders).
REMIND_BEFORE = timedelta(minutes=5)
# Сколько секунд живёт отметка ожидания пары: клиент повторяет «Играть», и ушедший игрок выпадает из ожидания сам.
WAIT_TTL_S = 120
# Форматы, которые идут турами (а не «играешь, пока идёт время»): у них свой конец (finished_at) и нет «огня».
ROUND_FORMATS = ("swiss", "match")


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


def berserk_allowed(arena: Arena) -> bool:
    """Берсерк есть в аренах, кроме пули без добавки с базой до минуты (1+0): половина минуты без добавки — лотерея."""
    if (arena.format or "arena") != "arena":
        return False
    return arena.increment_ms > 0 or arena.base_time_ms > BERSERK_MIN_BASE_MS


def pairing_open(arena: Arena, now: datetime | None = None) -> bool:
    """Арена сейчас создаёт пары: формат arena, начало уже наступило, «последний старт» — ещё нет."""
    now = now or _now()
    return (arena.format or "arena") == "arena" and _aware(arena.starts_at) <= now < last_start(arena)


def status(arena: Arena, now: datetime | None = None, open_games: int = 0) -> str:
    """
    scheduled → running (пары создаются) → closing (пар больше нет: доигрываются партии или идёт время до конца) →
    finished (конец наступил и все партии сыграны — итоги окончательные). open_games — число несыгранных партий
    арены, его передаёт вызывающий. Швейцарка: scheduled → running → finished (когда записан finished_at, то есть
    сыгран последний тур), её объявленный конец на статус не влияет.
    """
    now = now or _now()
    if now < _aware(arena.starts_at):
        return "scheduled"
    if arena.format in ROUND_FORMATS:
        return "finished" if arena.finished_at is not None else "running"
    if now < last_start(arena):
        return "running"
    return "closing" if open_games > 0 or now < _aware(arena.ends_at) else "finished"


async def open_games(db: AsyncSession, arena_id: int) -> int:
    """Число партий арены без результата (arena_games.result пуст): идущих или ещё не засчитанных."""
    return await db.scalar(select(func.count()).select_from(ArenaGame).where(
        ArenaGame.arena_id == arena_id, ArenaGame.result.is_(None))) or 0


async def ensure_schedule(db: AsyncSession, now: datetime | None = None) -> None:
    """
    Приводит арены ближайших LOOKAHEAD к расписанию конференций: недостающие создаёт (каждую — один раз), а ещё не
    начавшиеся арены, которых в расписании больше нет (его поменяли или конференцию отключили), убирает — если в них
    никто не вошёл.
    """
    now = now or _now()
    horizon = max(LOOKAHEAD, match_rules.MATCH_LOOKAHEAD)
    plan: dict[tuple[str, datetime], Arena] = {}
    for item in arena_schedule.planned(now, LOOKAHEAD):
        plan[(item.schedule_key, item.starts_at)] = Arena(
            schedule_key=item.schedule_key, conference=item.conference, base_time_ms=item.slot.base_time_ms,
            increment_ms=item.slot.increment_ms, starts_at=item.starts_at, ends_at=item.ends_at,
            format=item.slot.format, rounds=item.slot.rounds)
    # Матчи конференций видны для записи заранее — на MATCH_LOOKAHEAD вперёд.
    slot = match_rules.MATCH_SLOT
    for match in match_rules.planned_matches(now, match_rules.MATCH_LOOKAHEAD, arena_schedule.active_conferences()):
        plan[(match.schedule_key, match.starts_at)] = Arena(
            schedule_key=match.schedule_key, conference=match.home, opponent_conference=match.guest,
            base_time_ms=slot.base_time_ms, increment_ms=slot.increment_ms, starts_at=match.starts_at,
            ends_at=match.ends_at, format=slot.format, rounds=slot.rounds)
    rows = (await db.execute(select(Arena.id, Arena.schedule_key, Arena.starts_at).where(
        Arena.schedule_key.is_not(None), Arena.ends_at > now, Arena.starts_at < now + horizon))).all()
    existing = {(key, _aware(starts_at)) for _, key, starts_at in rows}
    for slot_key, new_arena in plan.items():
        if slot_key not in existing:
            db.add(new_arena)
    stale = [arena_id for arena_id, key, starts_at in rows
             if _aware(starts_at) > now and (key, _aware(starts_at)) not in plan]
    if stale:
        taken = set((await db.execute(select(ArenaPlayer.arena_id).where(ArenaPlayer.arena_id.in_(stale)))).scalars())
        empty = [arena_id for arena_id in stale if arena_id not in taken]
        if empty:
            await db.execute(delete(ArenaReminder).where(ArenaReminder.arena_id.in_(empty)))
            await db.execute(delete(Arena).where(Arena.id.in_(empty)))
    await db.commit()


def points(result_for_player: float, streak_before: int) -> int:
    """
    Очки за партию: победа 2, ничья 1; на «огне» (FIRE_AFTER побед подряд) — вдвое. result_for_player — 1.0, 0.5 или
    0.0; streak_before — серия побед игрока до этой партии (в швейцарке передаётся 0 — «огня» там нет).
    """
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


def check_entry(user: User) -> None:
    """
    Допуск в арену: единственное условие — честная игра. Рейтинг и число сыгранных партий на вход не влияют
    (решение владельца: никакого деления игроков по силе), новичок может встретиться с сильнейшим.
    """
    if user.is_cheater:
        raise DomainError("arena_fair_play")


async def divisions(db: AsyncSession, arena: Arena) -> list[Arena]:
    """Все деления одной арены по порядку: первая (корневая) запись и записи, у которых она в parent_id."""
    root_id = arena.parent_id or arena.id
    return list((await db.execute(select(Arena).where(
        (Arena.id == root_id) | (Arena.parent_id == root_id)).order_by(Arena.division))).scalars().all())


async def join(db: AsyncSession, arena: Arena, user: User) -> ArenaPlayer:
    """
    Вход в арену: допуск, затем первое неполное деление (или новое). Уже участник любого деления — его запись, без
    повторной проверки допуска. Оконченная арена — arena_finished, арена после «последнего старта» —
    arena_pairing_closed. В записи участника запоминаются рейтинг в категории и конференция на момент входа.
    """
    now = _now()
    if status(arena, now) == "finished":
        raise DomainError("arena_finished")
    if arena.format == "arena" and now >= last_start(arena):
        raise DomainError("arena_pairing_closed")
    from src.services import conferences

    if arena.format == "match":
        existing_player = await _player(db, arena.id, user.id)
        if existing_player:
            return existing_player
        check_match_entry(arena, user, now)
    family = await divisions(db, arena)
    family_ids = [a.id for a in family]
    existing = await db.scalar(select(ArenaPlayer).where(
        ArenaPlayer.arena_id.in_(family_ids), ArenaPlayer.user_id == user.id))
    if existing:
        return existing
    check_entry(user)
    counts = dict((await db.execute(select(ArenaPlayer.arena_id, func.count()).where(
        ArenaPlayer.arena_id.in_(family_ids)).group_by(ArenaPlayer.arena_id))).tuples().all())
    target = next((a for a in family if counts.get(a.id, 0) < DIVISION_SIZE), None)
    if target is None:
        root = family[0]
        target = Arena(schedule_key=None, base_time_ms=root.base_time_ms, increment_ms=root.increment_ms,
                       starts_at=root.starts_at, ends_at=root.ends_at, format=root.format, rounds=root.rounds,
                       division=family[-1].division + 1, parent_id=root.id, conference=root.conference)
        db.add(target)
        await db.flush()
    category = classify_time_control(arena.base_time_ms, arena.increment_ms)
    # Конференция запоминается на входе (33.6): поздняя смена страны зачёт этой арены не меняет.
    player = ArenaPlayer(arena_id=target.id, user_id=user.id, rating=user.rating_for(category),
                         conference=conferences.conference_of(user.country))
    db.add(player)
    await db.commit()
    await db.refresh(player)
    return player


def check_match_entry(arena: Arena, user: User, now: datetime) -> None:
    """
    Запись на матч конференций: честная игра, запись ещё открыта (match_entry_closed), у игрока есть конференция
    (match_no_conference) и это одна из двух сторон матча (match_wrong_conference). Порогов по силе нет.
    """
    from src.services import conferences

    check_entry(user)
    if not match_rules.entry_open(_aware(arena.starts_at), now):
        raise DomainError("match_entry_closed")
    conference = conferences.conference_of(user.country)
    if conference is None:
        raise DomainError("match_no_conference")
    if conference not in (arena.conference, arena.opponent_conference):
        raise DomainError("match_wrong_conference")


def _wait_key(arena_id: int) -> str:
    return f"arena:{arena_id}:waiting"


async def leave_waiting(arena_id: int, user_id: int) -> None:
    await redis_module.redis_client.hdel(_wait_key(arena_id), str(user_id))


async def waiting_ids(arena_id: int) -> set[int]:
    """
    Игроки, ждущие пару в арене: записи хэша Redis arena:{id}:waiting (игрок → время отметки) не старше WAIT_TTL_S.
    Устаревшие записи заодно удаляются.
    """
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
    (клиент повторяет запрос, пока не начнётся партия). Возвращает {"game_id": …} или {"waiting": true}. У игрока уже
    идёт партия этой арены (пару составил другой, а страница ещё повторяет запрос) — её номер, без нового ожидания:
    иначе следующий нажавший «Играть» получил бы в пару занятого игрока.
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
    playing = await current_game(db, arena.id, user.id)
    if playing is not None:
        await leave_waiting(arena.id, user.id)
        return {"game_id": playing}
    await redis_module.redis_client.hset(_wait_key(arena.id), mapping={str(user.id): str(_now().timestamp())})
    others = [uid for uid in await waiting_ids(arena.id) if uid != user.id]
    if not others:
        return {"waiting": True}
    players = {p.user_id: p for p in (await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == arena.id, ArenaPlayer.user_id.in_(others))
    )).scalars()}
    last = await _last_opponent(db, arena.id, user.id)

    def distance(uid: int) -> tuple[int, int, int]:
        """Чем меньше, тем лучше соперник: сначала не прошлый соперник, затем разница очков, затем рейтингов."""
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
                                              connection_manager=manager, db=db, initiator_id=user.id, is_rated=True,
                                              arena=_game_marker(arena))
    db.add(ArenaGame(arena_id=arena.id, game_id=started["game_id"], white_id=white, black_id=black))
    await db.commit()
    return {"game_id": started["game_id"]}


def _game_marker(arena: Arena) -> dict:
    """Пометка партии арены для состояния партии и события match_found: клиент показывает по ней «берсерк»."""
    return {"arena_id": arena.id, "berserk_allowed": berserk_allowed(arena)}


async def is_arena_game(db: AsyncSession, game_id: int) -> bool:
    return await db.scalar(select(ArenaGame.id).where(ArenaGame.game_id == game_id)) is not None


async def game_state_fields(db: AsyncSession, game_id: int) -> dict[str, str]:
    """Поля арены для состояния партии, восстановленного из базы (game_state._recover_state_from_db)."""
    record = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    arena = await db.get(Arena, record.arena_id) if record is not None else None
    if record is None or arena is None:
        return {}
    fields = {"arena_id": str(arena.id), "berserk_allowed": "1" if berserk_allowed(arena) else "0"}
    for color in ("white", "black"):
        if getattr(record, f"{color}_berserk"):
            fields[f"{color}_berserk"] = "1"
    return fields


async def berserk(db: AsyncSession, game_id: int, user_id: int) -> dict | None:
    """
    «Берсерк» игрока в партии арены: отметка в записи партии и новые часы в состоянии партии. Возвращает
    {"color", "state"} (свежее состояние партии) или None, если берсерк уже был; отказ — DomainError.
    """
    from src.models.game import Game
    from src.services.game_state import state_manager

    record = (await db.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one_or_none()
    if record is None or user_id not in (record.white_id, record.black_id):
        raise DomainError("berserk_unavailable")
    res = await state_manager.apply_berserk(game_id, user_id)
    if res["status"] == "error":
        raise DomainError(res["code"])
    if res["status"] != "ok":
        return None
    color = res["color"]
    setattr(record, f"{color}_berserk", True)
    # Копия часов в записи партии: до первого хода её больше никто не обновит, а из неё состояние восстанавливается.
    game = await db.get(Game, game_id)
    if game is not None:
        setattr(game, f"{color}_time_ms", int(res["state"][f"{color}_time_ms"]))
    await db.commit()
    return {"color": color, "state": res["state"]}


async def on_game_aborted(db: AsyncSession, game_id: int, no_show: str | None) -> bool:
    """
    Партия арены отменена до первых ходов (без commit). no_show — сторона, не сделавшая первый ход: ей поражение,
    сопернику победа с очками. None (сторона неизвестна, например сверка после сбоя) — партия закрыта без очков, чтобы
    итоги арены не ждали её вечно.
    """
    if no_show in ("white", "black"):
        # Победа по неявке — без бонуса берсерка: риска за доской не было.
        return await on_game_finished(db, game_id, "0-1" if no_show == "white" else "1-0", berserk_bonus=False)
    game = await _locked_game(db, game_id)
    if game is None or game.result is not None:
        return False
    game.result, game.white_points, game.black_points = "*", 0, 0
    return True


async def _locked_game(db: AsyncSession, game_id: int) -> ArenaGame | None:
    """
    Запись партии арены под блокировкой строки (SELECT ... FOR UPDATE) до конца транзакции: второй одновременный
    финиш той же партии (событие партии и сверка после сбоя) ждёт и видит уже записанный результат.
    populate_existing — перечитать строку, даже если объект уже есть в сессии.
    """
    return (await db.execute(
        select(ArenaGame).where(ArenaGame.game_id == game_id).with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def on_game_finished(db: AsyncSession, game_id: int, result: str, termination: str | None = None,
                           plies: int | None = None, berserk_bonus: bool = True) -> bool:
    """
    Партия арены закончилась: очки, серии, счётчики (без commit). False — это не партия арены или она уже засчитана.
    result — "1-0", "0-1" или ничья; termination и plies нужны для правила ранней ничьей по соглашению;
    berserk_bonus=False — победа без бонуса берсерка (неявка соперника). Партия и строки обоих участников берутся под
    блокировкой (порядок — по user_id, чтобы встречные транзакции не ждали друг друга по кругу): очки не теряются и не
    начисляются дважды при одновременном завершении партий.
    """
    game = await _locked_game(db, game_id)
    if game is None or game.result is not None:
        return False
    players = {p.user_id: p for p in (await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == game.arena_id,
                                  ArenaPlayer.user_id.in_((game.white_id, game.black_id)))
        .order_by(ArenaPlayer.user_id).with_for_update().execution_options(populate_existing=True)
    )).scalars()}
    white_score = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
    # Договорная ничья в самом начале очков не приносит (и рвёт серию): таблица — за сыгранные партии.
    early_draw = result == "1/2-1/2" and termination == "agreement" and plies is not None and plies < EARLY_DRAW_PLIES
    game.result = result
    sides = ((game.white_id, white_score, "white"), (game.black_id, 1.0 - white_score, "black"))
    arena = await db.get(Arena, game.arena_id)
    swiss = arena is not None and arena.format in ROUND_FORMATS
    for user_id, score, color in sides:
        player = players.get(user_id)
        if player is None:
            continue
        # Правило ранней ничьей — для арены (в швейцарке тур есть тур, ничья в нём считается как обычно).
        earned = 0 if early_draw and not swiss else points(score, 0 if swiss else player.streak)
        if score == 1.0 and berserk_bonus and not swiss and getattr(game, f"{color}_berserk"):
            earned += BERSERK_BONUS
        setattr(game, f"{color}_points", earned)
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
    if arena is None or arena.format not in ROUND_FORMATS:
        return
    await advance_swiss(db, arena)  # сама перечитывает арену под блокировкой
    await db.commit()


# --- Швейцарка между людьми -------------------------------------------------------------------------------

async def advance_swiss(db: AsyncSession, arena: Arena, now: datetime | None = None) -> None:
    """
    Продвигает швейцарку или матч конференций (без commit): после начала — первый тур; тур сыгран — следующий или
    конец. Меньше двух участников на старте (у матча — ни одной доски) — турнир окончен без партий.

    Атомарность: когда тур кончается одновременно на многих досках, продвигать его пытаются все завершившие партии и
    открытые страницы. Решение принимается под блокировкой строки арены (SELECT ... FOR UPDATE, до commit
    вызывающего): первый открывает тур, остальные ждут и видят уже новый current_round с несыгранными партиями.
    Дешёвая проверка без блокировки отсекает обычный случай «тур ещё идёт».
    """
    from src.services import tournament_rules as rules

    now = now or _now()
    if arena.format not in ROUND_FORMATS or arena.finished_at is not None or now < _aware(arena.starts_at):
        return
    if await _round_in_progress(db, arena):
        return
    locked = (await db.execute(select(Arena).where(Arena.id == arena.id).with_for_update()
                               .execution_options(populate_existing=True))).scalar_one()
    if locked.finished_at is not None or await _round_in_progress(db, locked):
        return
    games = list((await db.execute(select(ArenaGame).where(ArenaGame.arena_id == arena.id)
                                   .execution_options(populate_existing=True))).scalars())
    players = list((await db.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == arena.id)
        .order_by(ArenaPlayer.rating.desc(), ArenaPlayer.joined_at, ArenaPlayer.id)
        .execution_options(populate_existing=True)
    )).scalars())
    if arena.format == "match":
        await _advance_match(db, arena, players, now)
        return
    if arena.current_round >= arena.rounds or len(players) < 2:
        arena.finished_at = now
        return
    arena.current_round += 1
    seat_of = {p.user_id: i + 1 for i, p in enumerate(players)}
    user_of = {seat: uid for uid, seat in seat_of.items()}
    pairable = list(players)
    if len(pairable) % 2:
        # Свободный тур — слабейшему по очкам из тех, у кого его ещё не было (при равных очках — младшему по посеву);
        # если он был уже у всех — последнему по посеву.
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


async def _advance_match(db: AsyncSession, arena: Arena, players: list[ArenaPlayer], now: datetime) -> None:
    """
    Следующий тур матча конференций (арена уже под блокировкой). Перед первым туром — составы: доски по рейтингу на
    входе (match_rules.lineup, записываются в arena_players.board); ни одной доски — матч окончен без партий. Цвета
    доски — match_rules.board_colors.
    """
    if arena.current_round == 0:
        order = [p.user_id for p in sorted(players, key=lambda p: (_aware(p.joined_at) if p.joined_at else now, p.id))]
        boards = match_rules.lineup(players, arena.conference or "", arena.opponent_conference or "", order)
        for number, (home, guest) in enumerate(boards, 1):
            home.board = guest.board = number  # type: ignore[attr-defined]
    seated = sorted((p for p in players if p.board), key=lambda p: (p.board, p.conference != arena.conference))
    if arena.current_round >= arena.rounds or not seated:
        arena.finished_at = now
        return
    arena.current_round += 1
    for home, guest in zip(seated[::2], seated[1::2], strict=True):
        home_white = match_rules.board_colors(home.board or 0, arena.current_round)
        white, black = (home, guest) if home_white else (guest, home)
        await _start_swiss_game(db, arena, white.user_id, black.user_id)


async def match_view(db: AsyncSession, arena: Arena) -> dict:
    """
    Матч конференций для страницы: хозяин, гость, счёт сторон (победа 1, ничья ½) и доски — пары составов с очками
    каждого; до старта доски — предварительный состав по тем же правилам (записи ещё нет в arena_players.board).
    """
    rows = (await db.execute(select(ArenaPlayer, User.username).join(User, User.id == ArenaPlayer.user_id)
                             .where(ArenaPlayer.arena_id == arena.id).order_by(ArenaPlayer.joined_at, ArenaPlayer.id))).all()
    name = {p.user_id: username for p, username in rows}
    players = [p for p, _ in rows]
    home_key, guest_key = arena.conference or "", arena.opponent_conference or ""
    if any(p.board for p in players):
        by_board: dict[int, dict[str, ArenaPlayer]] = {}
        for p in players:
            if p.board:
                by_board.setdefault(p.board, {})["home" if p.conference == home_key else "guest"] = p
        pairs = [(by_board[n]["home"], by_board[n]["guest"]) for n in sorted(by_board)]
    else:
        pairs = match_rules.lineup(players, home_key, guest_key, [p.user_id for p in players])  # type: ignore[assignment]

    def seat(p: ArenaPlayer) -> dict:
        return {"username": name[p.user_id], "rating": p.rating, "score": match_rules.side_score(p.score)}

    def total(conference: str) -> float:
        return match_rules.side_score(sum(p.score for p in players if p.conference == conference))

    return {"home": home_key, "guest": guest_key, "home_score": total(home_key), "guest_score": total(guest_key),
            "home_players": sum(p.conference == home_key for p in players),
            "guest_players": sum(p.conference == guest_key for p in players),
            "entry_open": match_rules.entry_open(_aware(arena.starts_at), _now()),
            "boards": [{"board": n, "home": seat(h), "guest": seat(g)} for n, (h, g) in enumerate(pairs, 1)]}


async def _round_in_progress(db: AsyncSession, arena: Arena) -> bool:
    """В текущем туре швейцарки есть несыгранная партия (читается из базы, а не из объектов сессии)."""
    return bool(await db.scalar(select(func.count()).select_from(ArenaGame).where(
        ArenaGame.arena_id == arena.id, ArenaGame.round == arena.current_round, ArenaGame.result.is_(None))))


async def _start_swiss_game(db: AsyncSession, arena: Arena, white: int, black: int) -> None:
    """Партия тура; начать не удалось (кто-то из пары занят другой партией) — ничья без игры, чтобы тур не встал."""
    from src.models.game import Game, GameStatus
    from src.services.connection_manager import manager
    from src.services.matchmaker import MatchmakingError, matchmaker

    try:
        started = await matchmaker.start_pvp_game(white, black, arena.base_time_ms, arena.increment_ms,
                                                  connection_manager=manager, db=db, is_rated=True,
                                                  arena=_game_marker(arena))
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
    """Таблица итогов для страницы арены — порядок ranked; место — номер строки."""
    return [{"place": i + 1, "username": name, "score": p.score, "games": p.games, "wins": p.wins,
             "fire": p.streak >= FIRE_AFTER, "rating": p.rating, "performance": perf, "conference": p.conference}
            for i, (p, name, perf) in enumerate(await ranked(db, arena_id))]


async def ranked(db: AsyncSession, arena_id: int) -> list[tuple[ArenaPlayer, str, int | None]]:
    """
    Участники по местам: (участник, имя, перформанс). Порядок: очки; при равенстве — перформанс в арене, затем меньше
    партий (те же очки быстрее), затем раньше вошедший. Партии, закрытые без очков («*»), в перформанс не идут.
    Им пользуются таблица итогов и награды (src/services/arena_awards.py).
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

    return [(p, name, perf[p.user_id]) for p, name in sorted(rows, key=key)]


def view(arena: Arena, now: datetime | None = None, open_games: int = 0) -> dict:
    """
    Карточка арены для клиента: контроль времени, начало и конец, статус, последний старт, доступен ли берсерк,
    конференция, вечерняя ли это арена и деление.
    """
    out = {"id": arena.id, "schedule_key": arena.schedule_key, "format": arena.format, "rounds": arena.rounds,
           "current_round": arena.current_round, "base_time_ms": arena.base_time_ms,
           "increment_ms": arena.increment_ms, "starts_at": _aware(arena.starts_at).isoformat(),
           "ends_at": _aware(arena.ends_at).isoformat(), "status": status(arena, now, open_games),
           "open_games": open_games}
    if arena.format == "arena":
        out["last_start_at"] = last_start(arena).isoformat()
    out["berserk"] = berserk_allowed(arena)
    out["conference"] = arena.conference
    out["opponent_conference"] = arena.opponent_conference
    out["evening"] = arena_schedule.is_evening(arena.schedule_key)
    out["division"] = arena.division or 1
    out["parent_id"] = arena.parent_id
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


async def counts(db: AsyncSession, arena_ids: list[int]) -> tuple[dict[int, int], dict[int, int]]:
    """Число участников и идущих партий по аренам — двумя запросами на весь список."""
    if not arena_ids:
        return {}, {}
    players = dict((await db.execute(select(ArenaPlayer.arena_id, func.count()).where(
        ArenaPlayer.arena_id.in_(arena_ids)).group_by(ArenaPlayer.arena_id))).tuples().all())
    unfinished = dict((await db.execute(select(ArenaGame.arena_id, func.count()).where(
        ArenaGame.arena_id.in_(arena_ids), ArenaGame.result.is_(None)).group_by(ArenaGame.arena_id))).tuples().all())
    return players, unfinished


# --- Напоминания о начале арены (33.4) ---------------------------------------------------------------------

async def has_reminder(db: AsyncSession, arena_id: int, user_id: int) -> bool:
    return await db.scalar(select(ArenaReminder.id).where(
        ArenaReminder.arena_id == arena_id, ArenaReminder.user_id == user_id)) is not None


async def set_reminder(db: AsyncSession, arena: Arena, user_id: int, on: bool) -> bool:
    """«Напомнить» / «не напоминать». Включить можно только до начала арены. Возвращает, включено ли напоминание."""
    if on and status(arena) != "scheduled":
        raise DomainError("arena_reminder_too_late")
    exists = await has_reminder(db, arena.id, user_id)
    if on and not exists:
        db.add(ArenaReminder(arena_id=arena.id, user_id=user_id))
    elif not on and exists:
        await db.execute(delete(ArenaReminder).where(
            ArenaReminder.arena_id == arena.id, ArenaReminder.user_id == user_id))
    await db.commit()
    return on


async def send_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """
    Уведомления тем, кто просил напомнить: арена начинается не позже чем через REMIND_BEFORE (или уже идёт — если
    плановая задача опоздала) и ещё не кончилась. Каждому — один раз (отметка arena_reminders.sent_at). Возвращает
    число отправленных. Без commit: его делает вызывающая задача (src/worker/tasks.py).
    """
    from src.services import notifications

    now = now or _now()
    rows = (await db.execute(
        select(ArenaReminder, Arena).join(Arena, Arena.id == ArenaReminder.arena_id)
        .where(ArenaReminder.sent_at.is_(None), Arena.starts_at <= now + REMIND_BEFORE, Arena.ends_at > now)
        .order_by(ArenaReminder.id)
    )).all()
    sent = 0
    for reminder, arena in rows:
        reminder.sent_at = now
        notification = await notifications.record(db, reminder.user_id, "arena_reminder", {
            "arena_id": arena.id, "base_time_ms": arena.base_time_ms, "increment_ms": arena.increment_ms,
            "starts_at": _aware(arena.starts_at).isoformat(),
        })
        await notifications.deliver(reminder.user_id, notification)
        sent += 1
    return sent
