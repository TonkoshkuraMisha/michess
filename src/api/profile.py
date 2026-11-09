# --- FILE: src/api/profile.py ---

import time
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc, asc, func, case
from sqlalchemy.orm import aliased

from src.db.session import get_db
from src.db.seed import ensure_champion_seeded, get_champion_meta, extract_pgn_metadata
from src.api.deps import get_current_user
from src.models.user import User
from src.models.game import Game, GameStatus

router = APIRouter(prefix="/profile", tags=["Profile & Games"])


class QueueJoinRequest(BaseModel):
    base_time_ms: int = 180000
    increment_ms: int = 0


async def _resolve_user(db: AsyncSession, username: str) -> User | None:
    champ_meta = get_champion_meta(username)
    if champ_meta is not None:
        champ_user = await ensure_champion_seeded(db, champ_meta["id"])
        if champ_user is not None:
            return champ_user

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()
    if user:
        return user

    result = await db.execute(select(User).where(User.username.ilike(f"%{username}%")))
    return result.scalars().first()


async def _build_active_game_payload(db: AsyncSession, game_id: int, user_id: int) -> dict | None:
    """Формирует полный слепок активной партии для игрока (цвет, часы, FEN, PGN, версия стейта)."""
    from src.services.game_state import state_manager

    state = await state_manager.get_game_state(game_id)
    if not state or state.get("status") != "in_progress":
        return None

    white_id = int(state["white_id"])
    black_id = int(state["black_id"])
    if int(user_id) not in (white_id, black_id):
        return None

    white_user = await db.get(User, white_id)
    black_user = await db.get(User, black_id)

    now_ms = int(time.time() * 1000)
    elapsed = max(0, now_ms - int(state.get("last_move_at", now_ms)))
    turn = state.get("turn", "white")
    w_ms = int(state.get("white_time_ms", 180000))
    b_ms = int(state.get("black_time_ms", 180000))

    white_time = max(0, w_ms - elapsed) if turn in ("white", "w") else w_ms
    black_time = max(0, b_ms - elapsed) if turn in ("black", "b") else b_ms

    return {
        "active": True,
        "event": "match_found",
        "game_id": int(game_id),
        "color": "white" if int(user_id) == white_id else "black",
        "opponent_id": black_id if int(user_id) == white_id else white_id,
        "white_username": white_user.username if white_user else "Белые",
        "white_rating": white_user.rating if white_user else 1200,
        "black_username": black_user.username if black_user else "Черные",
        "black_rating": black_user.rating if black_user else 1200,
        "base_time_ms": int(state.get("base_time_ms", 180000)),
        "increment_ms": int(state.get("increment_ms", 0)),
        "white_time_ms": white_time,
        "black_time_ms": black_time,
        "fen": state.get("board_fen"),
        "pgn": state.get("pgn", ""),
        "state_version": int(state.get("state_version", 0)),
    }


@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "rating": current_user.rating,
        "is_cheater": current_user.is_cheater,
        "trust_factor": current_user.trust_factor,
        "created_at": current_user.created_at,
    }


@router.get("/leaderboard")
async def get_leaderboard(
        limit: int = Query(50, ge=1, le=100, description="Количество игроков в топе"),
        db: AsyncSession = Depends(get_db),
):
    query = select(User).where(User.is_cheater == False).order_by(desc(User.rating)).limit(limit)  # noqa: E712
    result = await db.execute(query)
    top_users = result.scalars().all()

    return [
        {"rank": index + 1, "username": user.username, "rating": user.rating}
        for index, user in enumerate(top_users)
    ]


@router.get("/games/my-active")
async def get_my_active_game(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Возвращает текущую активную партию авторизованного игрока (для синхронизации старта и ходов)."""
    from src.services.game_state import state_manager

    gid_str = await state_manager.redis.get(f"user:{current_user.id}:current_game")
    if not gid_str:
        return {"active": False}

    payload = await _build_active_game_payload(db, int(gid_str), current_user.id)
    if not payload:
        return {"active": False}
    return payload


@router.post("/matchmaking/join")
async def join_matchmaking_http(
        req: QueueJoinRequest,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Публикует вызов в лобби по HTTP (или сразу запускает матч, если соперник уже ждёт)."""
    from src.services.matchmaker import matchmaker

    matched_gid = await matchmaker.join_queue(
        user_id=current_user.id,
        username=current_user.username,
        rating=current_user.rating,
        base_time_ms=req.base_time_ms,
        increment_ms=req.increment_ms,
        min_rating=max(0, current_user.rating - 150),
        max_rating=current_user.rating + 150,
        db=db,
    )
    if matched_gid is not None:
        payload = await _build_active_game_payload(db, int(matched_gid), current_user.id)
        if payload:
            return payload
    return {"active": False, "queued": True}


@router.post("/matchmaking/leave")
async def leave_matchmaking_http(current_user: User = Depends(get_current_user)):
    """Удаляет вызов игрока из очереди лобби."""
    from src.services.matchmaker import matchmaker
    await matchmaker.leave_queue(current_user.id)
    return {"status": "left"}


@router.post("/matchmaking/accept/{target_user_id}")
async def accept_challenge_http(
        target_user_id: int,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """
    Принимает вызов соперника из лобби по HTTP и возвращает данные начавшейся партии.
    Безопасен к гонкам с WebSocket-сообщением accept_challenge.
    """
    from src.services.matchmaker import matchmaker
    from src.services.connection_manager import manager
    from src.services.game_state import state_manager

    if int(target_user_id) == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя принять собственный вызов")

    game_id = await matchmaker.accept_challenge(
        challenger_id=int(target_user_id),
        acceptor_id=current_user.id,
        connection_manager=manager,
        state_manager=state_manager,
        db=db,
    )

    if game_id is None:
        existing_gid = await state_manager.redis.get(f"user:{current_user.id}:current_game")
        if existing_gid:
            game_id = int(existing_gid)

    if game_id is None:
        raise HTTPException(status_code=404, detail="Вызов уже неактивен или принят другим игроком")

    payload = await _build_active_game_payload(db, int(game_id), current_user.id)
    if not payload:
        raise HTTPException(status_code=404, detail="Не удалось инициализировать состояние партии")

    return payload


@router.get("/games/live")
async def get_live_games(db: AsyncSession = Depends(get_db)):
    """Возвращает список активных партий, идущих прямо сейчас (для вкладки Live и режима зрителя)."""
    from src.services.game_state import state_manager
    from src.services.connection_manager import manager

    game_ids = await state_manager.redis.smembers("active_games")
    if not game_ids:
        return []

    active_states: list[tuple[int, dict]] = []
    user_ids: set[int] = set()

    for gid_raw in game_ids:
        try:
            gid = int(gid_raw)
        except ValueError:
            continue
        state = await state_manager.get_game_state(gid)
        if not state or state.get("status") != "in_progress":
            continue

        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        user_ids.add(white_id)
        user_ids.add(black_id)
        active_states.append((gid, state))

    if not active_states:
        return []

    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_map = {u.id: u for u in users_res.scalars().all()}

    live_list = []
    for gid, state in active_states:
        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        white_user = users_map.get(white_id)
        black_user = users_map.get(black_id)
        spectators_set = getattr(manager, "game_spectators", {}).get(gid, set())

        live_list.append({
            "game_id": gid,
            "white_id": white_id,
            "black_id": black_id,
            "white_username": white_user.username if white_user else "Белые",
            "white_rating": white_user.rating if white_user else 1200,
            "black_username": black_user.username if black_user else "Черные",
            "black_rating": black_user.rating if black_user else 1200,
            "base_time_ms": int(state.get("base_time_ms", 180000)),
            "increment_ms": int(state.get("increment_ms", 0)),
            "state_version": int(state.get("state_version", 0)),
            "spectators_count": len(spectators_set),
        })

    live_list.sort(key=lambda x: x["game_id"], reverse=True)
    return live_list


@router.get("/{username}")
async def get_user_profile(username: str, db: AsyncSession = Depends(get_db)):
    user = await _resolve_user(db, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "username": user.username,
        "rating": user.rating,
        "is_cheater": user.is_cheater,
        "trust_factor": user.trust_factor,
        "created_at": user.created_at,
    }


@router.get("/{username}/games")
async def get_user_games(
        username: str,
        limit: int = Query(25, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        sort: str = Query("desc"),
        db: AsyncSession = Depends(get_db),
):
    user = await _resolve_user(db, username)
    if not user:
        raise HTTPException(status_code=404, detail=f"User {username} not found")

    WhiteUser = aliased(User)
    BlackUser = aliased(User)

    conditions = [
        or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
        Game.status == GameStatus.COMPLETED,
        Game.pgn.is_not(None),
        Game.pgn != "",
    ]

    count_query = select(func.count(Game.id)).where(*conditions)
    total_count = (await db.execute(count_query)).scalar() or 0

    null_date_flag = case(
        (or_(Game.pgn_date.is_(None), Game.pgn_date == "", Game.pgn_date.like("?%")), 1),
        else_=0,
    )

    if sort == "asc":
        order_clauses = [
            asc(null_date_flag),
            asc(Game.pgn_date),
            asc(Game.finished_at),
            asc(Game.id),
        ]
    else:
        order_clauses = [
            asc(null_date_flag),
            desc(Game.pgn_date),
            desc(Game.finished_at),
            desc(Game.id),
        ]

    games_query = (
        select(
            Game.id,
            Game.status,
            Game.is_rated,
            Game.result,
            Game.pgn_date,
            Game.site,
            Game.eco,
            Game.finished_at,
            Game.pgn,
            WhiteUser.username,
            WhiteUser.rating,
            BlackUser.username,
            BlackUser.rating,
        )
        .join(WhiteUser, Game.white_player_id == WhiteUser.id)
        .join(BlackUser, Game.black_player_id == BlackUser.id)
        .where(*conditions)
        .order_by(*order_clauses)
        .limit(limit)
        .offset(offset)
    )

    rows = (await db.execute(games_query)).all()

    items = []
    for (
            game_id,
            status_val,
            is_rated,
            result_val,
            pgn_date,
            site,
            eco,
            finished_at,
            pgn_text,
            w_name,
            w_rating,
            b_name,
            b_rating,
    ) in rows:
        if (not pgn_date or not site or not eco or not result_val or result_val == "*") and pgn_text:
            fallback_meta = extract_pgn_metadata(pgn_text, fallback_result=result_val or "*")
            result_val = result_val if (result_val and result_val != "*") else fallback_meta["result"]
            pgn_date = pgn_date or fallback_meta["pgn_date"]
            site = site or fallback_meta["site"]
            eco = eco or fallback_meta["eco"]

        items.append({
            "game_id": game_id,
            "white_username": w_name,
            "white_rating": w_rating,
            "black_username": b_name,
            "black_rating": b_rating,
            "status": status_val.value if hasattr(status_val, "value") else str(status_val),
            "is_rated": is_rated,
            "result": result_val or "*",
            "pgn_date": pgn_date,
            "site": site,
            "eco": eco,
            "finished_at": finished_at.isoformat() if finished_at else None,
        })

    return {
        "total": total_count,
        "items": items,
    }


@router.get("/games/{game_id}/pgn")
async def download_pgn(game_id: int, db: AsyncSession = Depends(get_db)):
    game = await db.get(Game, game_id)
    if not game or not game.pgn:
        raise HTTPException(status_code=404, detail="Game or PGN not found")

    headers = {"Content-Disposition": f"attachment; filename=michess_game_{game_id}.pgn"}
    return PlainTextResponse(content=game.pgn, media_type="application/x-chess-pgn", headers=headers)


@router.get("/matchmaking/queue")
async def get_matchmaking_queue():
    from src.services.matchmaker import matchmaker
    return await matchmaker.get_queue_players()
