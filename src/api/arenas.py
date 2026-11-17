# --- FILE: src/api/arenas.py ---
"""Арены — турниры между людьми (таск 17.2): расписание, вход, «Играть», таблица. Правила — src/services/arena.py."""

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import optional_user_id
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.arena import Arena, ArenaPlayer
from src.models.user import User
from src.services import arena as service
from src.services.matchmaker import MatchmakingError

router = APIRouter()

RECENT = timedelta(hours=6)
_CODES = {"arena_not_found": status.HTTP_404_NOT_FOUND}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_409_CONFLICT))


async def _players_count(db: AsyncSession, arena_id: int) -> int:
    return await db.scalar(select(func.count()).select_from(ArenaPlayer).where(ArenaPlayer.arena_id == arena_id)) or 0


@router.get("")
async def list_arenas(db: AsyncSession = Depends(get_db)):
    """Идущие, ближайшие (на 6 часов вперёд) и недавно законченные арены; расписание дополняется при запросе."""
    await service.ensure_schedule(db)
    now = service._now()
    rows = (await db.execute(
        select(Arena).where(Arena.ends_at > now - RECENT, Arena.starts_at < now + service.LOOKAHEAD)
        .order_by(Arena.starts_at, Arena.id)
    )).scalars().all()
    return {"arenas": [{**service.view(a, now, await service.open_games(db, a.id)), "players": await _players_count(db, a.id)}
                       for a in rows]}


@router.get("/current")
async def current_arena(db: AsyncSession = Depends(get_db)):
    """Для лобби: идущая арена с наибольшим числом игроков, иначе ближайшая."""
    await service.ensure_schedule(db)
    now = service._now()
    rows = (await db.execute(
        select(Arena).where(Arena.ends_at > now, Arena.starts_at < now + service.LOOKAHEAD).order_by(Arena.starts_at)
    )).scalars().all()
    if not rows:
        return {"arena": None}
    running = [a for a in rows if service.status(a, now) in ("running", "closing")]
    if running:
        counts = {a.id: await _players_count(db, a.id) for a in running}
        chosen = max(running, key=lambda a: (counts[a.id], -a.id))
    else:
        chosen = rows[0]
    return {"arena": {**service.view(chosen, now, await service.open_games(db, chosen.id)),
                      "players": await _players_count(db, chosen.id)}}


@router.get("/{arena_id}")
async def get_arena(arena_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await optional_user_id(request, db)
    try:
        arena = await service.get(db, arena_id)
    except DomainError as exc:
        raise _http(exc) from None
    if arena.format == "swiss":
        await service.advance_swiss(db, arena)  # тур мог закончиться, а турнир — начаться
        await db.commit()
    me = None
    if user_id is not None:
        joined = await service._player(db, arena.id, user_id) is not None
        me = {"joined": joined, "waiting": user_id in await service.waiting_ids(arena.id),
              "current_game_id": await service.current_game(db, arena.id, user_id) if joined else None}
    return {**service.view(arena, None, await service.open_games(db, arena.id)),
            "standings": await service.standings(db, arena.id), "me": me}


@router.post("/{arena_id}/join")
async def join_arena(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        await service.join(db, await service.get(db, arena_id), user)
    except DomainError as exc:
        raise _http(exc) from None
    return {"joined": True}


@router.post("/{arena_id}/ready")
async def ready(arena_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """«Играть»: пара с другим ожидающим или ожидание (клиент повторяет запрос)."""
    try:
        return await service.ready(db, await service.get(db, arena_id), user)
    except MatchmakingError as exc:
        raise exc.to_http(status.HTTP_409_CONFLICT) from None
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{arena_id}/leave-waiting")
async def leave_waiting(arena_id: int, user: User = Depends(get_current_user)):
    await service.leave_waiting(arena_id, user.id)
    return {"waiting": False}
