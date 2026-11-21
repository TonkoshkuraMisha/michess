# --- FILE: src/api/arenas.py ---
"""
Арены — турниры между людьми (таск 17.2): расписание, вход, «Играть», таблица, напоминание о начале. Правила —
src/services/arena.py, расписание по конференциям — src/services/arena_schedule.py.

Списки и страница арены открыты всем; вход, «Играть» и напоминания — только вошедшим. Арены, участники и партии
лежат в таблицах arenas, arena_players, arena_games, arena_reminders; кто сейчас ждёт пару — в Redis
(arena:{id}:waiting). Сами партии арены идут по общему WebSocket партий (src/api/websockets.py).
Месячная лига арен (GET /arenas/league) — src/services/arena_league.py.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.conferences import SEASON
from src.api.deps import get_current_user
from src.api.fair_play import optional_user_id
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.arena import Arena
from src.models.user import RatingCategory, User
from src.services import arena as service
from src.services import arena_awards, arena_league, conferences
from src.services.matchmaker import MatchmakingError

router = APIRouter()

# Сколько законченная арена ещё видна в списке.
RECENT = timedelta(hours=6)
# Статусы HTTP для кодов отказа сервиса; остальные отказы — 409 (конфликт с состоянием арены).
_CODES = {"arena_not_found": status.HTTP_404_NOT_FOUND, "arena_fair_play": status.HTTP_403_FORBIDDEN,
          "match_wrong_conference": status.HTTP_403_FORBIDDEN, "match_no_conference": status.HTTP_403_FORBIDDEN}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_409_CONFLICT))


async def _views(db: AsyncSession, rows: list[Arena], now) -> list[dict]:
    """Карточки арен списка: число участников и идущих партий — двумя запросами на весь список."""
    players, unfinished = await service.counts(db, [a.id for a in rows])
    return [{**service.view(a, now, unfinished.get(a.id, 0)), "players": players.get(a.id, 0)} for a in rows]


@router.get("")
async def list_arenas(db: AsyncSession = Depends(get_db)):
    """
    Идущие, ближайшие (на 6 часов вперёд) и недавно законченные арены; расписание дополняется при запросе.
    Законченные арены, в которые никто не вошёл, не показываются: при расписании пяти конференций они засоряли бы список.
    """
    await service.ensure_schedule(db)
    now = service._now()
    rows = list((await db.execute(
        select(Arena).where(Arena.ends_at > now - RECENT, Arena.starts_at < now + service.LOOKAHEAD)
        .order_by(Arena.starts_at, Arena.id)
    )).scalars().all())
    views = await _views(db, rows, now)
    return {"arenas": [v for v in views if v["status"] != "finished" or v["players"] > 0]}


@router.get("/league")
async def arena_league_table(request: Request, category: RatingCategory = Query("blitz"),
                             season: str | None = Query(None, pattern=SEASON), db: AsyncSession = Depends(get_db)):
    """
    Месячная лига арен: игроки по сумме очков арен сезона (по умолчанию — текущий месяц) в категории контроля. На
    рейтинг не влияет. Открыта всем; вошедшему — его строка (me), даже если он ниже первых строк таблицы.
    """
    return await arena_league.league(db, category, season, await optional_user_id(request, db))


@router.get("/current")
async def current_arena(db: AsyncSession = Depends(get_db)):
    """
    Для лобби: арена, в которую можно войти и играть прямо сейчас (пары ещё создаются), — та, где больше игроков;
    иначе ближайшая по времени начала. Арена, которая только доигрывает партии, в анонс не идёт.
    """
    await service.ensure_schedule(db)
    now = service._now()
    rows = list((await db.execute(
        select(Arena).where(Arena.ends_at > now, Arena.starts_at < now + service.LOOKAHEAD)
        .order_by(Arena.starts_at, Arena.id)
    )).scalars().all())
    views = await _views(db, rows, now)
    running = [v for v in views if v["status"] == "running"]
    if running:
        return {"arena": max(running, key=lambda v: (v["players"], -v["id"]))}
    upcoming = [v for v in views if v["status"] == "scheduled"]
    return {"arena": upcoming[0] if upcoming else None}


@router.get("/{arena_id}")
async def get_arena(arena_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Страница арены: карточка, таблица, зачёт конференций и — вошедшему игроку — его состояние (участвует ли, ждёт ли
    пару, идущая партия, напоминание, призовое место после итогов). Заодно продвигает швейцарку: тур мог закончиться.
    """
    user_id = await optional_user_id(request, db)
    try:
        arena = await service.get(db, arena_id)
    except DomainError as exc:
        raise _http(exc) from None
    if arena.format in service.ROUND_FORMATS:
        await service.advance_swiss(db, arena)  # тур мог закончиться, а турнир — начаться
        await db.commit()
    me = None
    if user_id is not None:
        joined = await service._player(db, arena.id, user_id) is not None
        # Игрок может быть в другом делении этой арены (33.2) — клиент перейдёт туда.
        division_id = None
        if not joined:
            for item in await service.divisions(db, arena):
                if item.id != arena.id and await service._player(db, item.id, user_id) is not None:
                    division_id = item.id
        me = {"username": getattr(await db.get(User, user_id), "username", None),  # по имени итоги находят строку игрока
              "joined": joined, "waiting": user_id in await service.waiting_ids(arena.id),
              "current_game_id": await service.current_game(db, arena.id, user_id) if joined else None,
              "division_arena_id": division_id,
              "reminder": await service.has_reminder(db, arena.id, user_id),
              # Призовое место (33.5) — только когда награды розданы, то есть итоги окончательные.
              "podium_place": await arena_awards.place_of(db, arena.id, user_id) if joined else None}
    return {**service.view(arena, None, await service.open_games(db, arena.id)),
            "standings": await service.standings(db, arena.id),
            # Зачёт конференций арены (33.6): сумма очков лучших участников каждой конференции.
            "conferences": await conferences.arena_table(db, arena.id), "me": me,
            # Матч конференций: счёт сторон и доски (src/services/conference_match_rules.py).
            "match": await service.match_view(db, arena) if arena.format == "match" else None}


@router.post("/{arena_id}/join")
async def join_arena(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Вход в арену — любому зарегистрированному игроку без флага нечестной игры; при переполнении игрок попадает в
    другое деление — его id в ответе.
    """
    try:
        player = await service.join(db, await service.get(db, arena_id), user)
    except DomainError as exc:
        raise _http(exc) from None
    return {"joined": True, "arena_id": player.arena_id}


@router.post("/{arena_id}/remind")
async def remind(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """«Напомнить»: незадолго до начала арены игроку придёт уведомление (33.4). Только до её начала."""
    try:
        return {"reminder": await service.set_reminder(db, await service.get(db, arena_id), user.id, True)}
    except DomainError as exc:
        raise _http(exc) from None


@router.delete("/{arena_id}/remind")
async def forget_reminder(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Отменить своё напоминание о начале арены."""
    try:
        return {"reminder": await service.set_reminder(db, await service.get(db, arena_id), user.id, False)}
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{arena_id}/ready")
async def ready(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """
    «Играть»: пара с другим ожидающим или ожидание (клиент повторяет запрос). Отметка ожидания в Redis считается
    действующей arena.WAIT_TTL_S секунд — кто перестал повторять запрос, тот больше не ждёт.
    """
    try:
        return await service.ready(db, await service.get(db, arena_id), user)
    except MatchmakingError as exc:
        raise exc.to_http(status.HTTP_409_CONFLICT) from None
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{arena_id}/leave-waiting")
async def leave_waiting(arena_id: int, user: User = Depends(get_current_user)):
    """Перестать ждать пару: убирает игрока из списка ожидающих арены в Redis."""
    await service.leave_waiting(arena_id, user.id)
    return {"waiting": False}
