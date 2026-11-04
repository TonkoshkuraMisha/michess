# --- FILE: src/api/profile.py ---

import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from sqlalchemy.orm import aliased

from src.db.session import get_db
from src.db.seed import ensure_champion_seeded, get_champion_meta
from src.api.deps import get_current_user
from src.models.user import User
from src.models.game import Game, GameStatus

router = APIRouter(prefix="/profile", tags=["Profile & Games"])


async def _resolve_user(db: AsyncSession, username: str) -> User | None:
    """
    Находит пользователя по точному имени или ID чемпиона.
    Если запрашивается чемпион из раздела «Легенды шахмат», автоматически засеивает его PGN-базу при первом обращении.
    """
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




@router.get("/games/live")
async def get_live_games(db: AsyncSession = Depends(get_db)):
    """Возвращает список активных партий, идущих прямо сейчас (для вкладки Live и режима зрителя)."""
    from src.services.game_state import state_manager
    from src.services.connection_manager import manager

    game_ids = await state_manager.redis.smembers("active_games")
    live_list = []

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
        white_user = await db.get(User, white_id)
        black_user = await db.get(User, black_id)

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

    games_query = (
        select(Game, WhiteUser.username, WhiteUser.rating, BlackUser.username, BlackUser.rating)
        .join(WhiteUser, Game.white_player_id == WhiteUser.id)
        .join(BlackUser, Game.black_player_id == BlackUser.id)
        .where(*conditions)
    )

    games_result = await db.execute(games_query)
    rows = games_result.all()

    results = []
    for game, w_name, w_rating, b_name, b_rating in rows:
        result_str = game.result or "*"
        pgn_date = None
        site = None
        eco = None

        if game.pgn:
            res_match = re.search(r'\[Result\s+"(.*?)"\]', game.pgn)
            if res_match:
                result_str = res_match.group(1)
            elif result_str == "*":
                match = re.search(r'(1-0|0-1|1/2-1/2)\s*$', game.pgn.strip())
                if match:
                    result_str = match.group(1)

            date_match = re.search(r'\[Date\s+"(.*?)"\]', game.pgn)
            if date_match and date_match.group(1) and not date_match.group(1).startswith("?"):
                pgn_date = date_match.group(1)
            else:
                edate_match = re.search(r'\[EventDate\s+"(.*?)"\]', game.pgn)
                if edate_match and edate_match.group(1) and not edate_match.group(1).startswith("?"):
                    pgn_date = edate_match.group(1)

            site_match = re.search(r'\[Site\s+"(.*?)"\]', game.pgn)
            if site_match and site_match.group(1) != "?":
                site = site_match.group(1)

            eco_match = re.search(r'\[ECO\s+"(.*?)"\]', game.pgn)
            if eco_match and eco_match.group(1) != "?":
                eco = eco_match.group(1)

        results.append({
            "game_id": game.id,
            "white_username": w_name,
            "white_rating": w_rating,
            "black_username": b_name,
            "black_rating": b_rating,
            "status": game.status.value if hasattr(game.status, "value") else str(game.status),
            "is_rated": game.is_rated,
            "result": result_str,
            "pgn_date": pgn_date,
            "site": site,
            "eco": eco,
            "finished_at": game.finished_at.isoformat() if game.finished_at else None,
        })

    def get_date_tuple(item):
        d_str = item["pgn_date"]
        if item["finished_at"] and not d_str:
            dt = datetime.fromisoformat(item["finished_at"])
            return (dt.year, dt.month, dt.day, item["game_id"])

        if not d_str or d_str.startswith("?"):
            return None

        parts = d_str.split(".")
        try:
            y = int(parts[0]) if parts[0] != "????" else None
            m = int(parts[1]) if len(parts) > 1 and not parts[1].startswith("?") else 0
            d = int(parts[2]) if len(parts) > 2 and not parts[2].startswith("?") else 0
            if y is None:
                return None
            return (y, m, d, item["game_id"])
        except ValueError:
            return None

    def sort_key_asc(item):
        t = get_date_tuple(item)
        return t if t is not None else (9999, 99, 99, item["game_id"])

    def sort_key_desc(item):
        t = get_date_tuple(item)
        return t if t is not None else (-9999, -99, -99, -item["game_id"])

    if sort == "asc":
        results.sort(key=sort_key_asc)
    else:
        results.sort(key=sort_key_desc, reverse=True)

    total_count = len(results)
    paginated_results = results[offset: offset + limit]

    return {
        "total": total_count,
        "items": paginated_results,
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
