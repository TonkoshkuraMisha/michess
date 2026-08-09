# --- FILE: src/api/profile.py ---

import re
import io
from datetime import datetime
import chess.pgn
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from sqlalchemy.orm import aliased

from src.db.session import get_db
from src.api.deps import get_current_user
from src.models.user import User
from src.models.game import Game, GameStatus

router = APIRouter(prefix="/profile", tags=["Profile & Games"])


@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "rating": current_user.rating,
        "is_cheater": current_user.is_cheater,
        "trust_factor": current_user.trust_factor,
        "created_at": current_user.created_at
    }


@router.get("/leaderboard")
async def get_leaderboard(
        limit: int = Query(50, ge=1, le=100, description="Количество игроков в топе"),
        db: AsyncSession = Depends(get_db)
):
    query = select(User).where(User.is_cheater == False).order_by(desc(User.rating)).limit(limit)
    result = await db.execute(query)
    top_users = result.scalars().all()

    return [
        {"rank": index + 1, "username": user.username, "rating": user.rating}
        for index, user in enumerate(top_users)
    ]


@router.get("/{username}")
async def get_user_profile(username: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()

    if not user:
        result = await db.execute(select(User).where(User.username.ilike(f"%{username}%")))
        user = result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "username": user.username,
        "rating": user.rating,
        "created_at": user.created_at
    }


@router.get("/{username}/games")
async def get_user_games(
        username: str,
        limit: int = Query(25, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        sort: str = Query("desc"),
        db: AsyncSession = Depends(get_db)
):
    user_result = await db.execute(select(User).where(User.username == username))
    user = user_result.scalars().first()

    if not user:
        user_result = await db.execute(select(User).where(User.username.ilike(f"%{username}%")))
        user = user_result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail=f"User {username} not found")

    WhiteUser = aliased(User)
    BlackUser = aliased(User)

    conditions = [
        or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
        Game.status == GameStatus.COMPLETED,
        Game.pgn.is_not(None),
        Game.pgn != ""
    ]

    # Извлекаем ВСЕ партии игрока для корректной сортировки в памяти сервера
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
        result_str = "*"
        pgn_date = None
        site = None
        eco = None

        if game.pgn:
            # Извлекаем результат
            res_match = re.search(r'\[Result\s+"(.*?)"\]', game.pgn)
            if res_match:
                result_str = res_match.group(1)
            else:
                match = re.search(r'(1-0|0-1|1/2-1/2)\s*$', game.pgn.strip())
                if match: result_str = match.group(1)

            # Извлекаем дату (предпочтение Date, затем EventDate)
            date_match = re.search(r'\[Date\s+"(.*?)"\]', game.pgn)
            if date_match and date_match.group(1) and not date_match.group(1).startswith("?"):
                pgn_date = date_match.group(1)
            else:
                edate_match = re.search(r'\[EventDate\s+"(.*?)"\]', game.pgn)
                if edate_match and edate_match.group(1) and not edate_match.group(1).startswith("?"):
                    pgn_date = edate_match.group(1)

            # Извлекаем место проведения
            site_match = re.search(r'\[Site\s+"(.*?)"\]', game.pgn)
            if site_match and site_match.group(1) != "?":
                site = site_match.group(1)

            # Извлекаем дебютный код (ECO)
            eco_match = re.search(r'\[ECO\s+"(.*?)"\]', game.pgn)
            if eco_match and eco_match.group(1) != "?":
                eco = eco_match.group(1)

        results.append({
            "game_id": game.id,
            "white_username": w_name,
            "white_rating": w_rating,
            "black_username": b_name,
            "black_rating": b_rating,
            "status": game.status.value,
            "is_rated": game.is_rated,
            "result": result_str,
            "pgn_date": pgn_date,
            "site": site,
            "eco": eco,
            "finished_at": game.finished_at.isoformat() if game.finished_at else None
        })

    def get_date_tuple(item):
        d_str = item["pgn_date"]
        # Для онлайн-партий используем finished_at
        if item["finished_at"] and not d_str:
            dt = datetime.fromisoformat(item["finished_at"])
            return (dt.year, dt.month, dt.day, item["game_id"])

        # Если даты нет - возвращаем None
        if not d_str or d_str.startswith("?"):
            return None

        parts = d_str.split('.')
        try:
            y = int(parts[0]) if parts[0] != '????' else None
            m = int(parts[1]) if len(parts) > 1 and parts[1] != '??' else 0
            d = int(parts[2]) if len(parts) > 2 and parts[2] != '??' else 0
            if y is None: return None
            return (y, m, d, item["game_id"])
        except ValueError:
            return None

    def sort_key_asc(item):
        t = get_date_tuple(item)
        # Если даты нет, отправляем в самый конец (9999 год)
        return t if t is not None else (9999, 99, 99, item["game_id"])

    def sort_key_desc(item):
        t = get_date_tuple(item)
        # Если даты нет, отправляем в самый конец даже при реверсивной сортировке (-9999)
        return t if t is not None else (-9999, -99, -99, -item["game_id"])

    if sort == "asc":
        results.sort(key=sort_key_asc)
    else:
        results.sort(key=sort_key_desc, reverse=True)

    total_count = len(results)
    paginated_results = results[offset: offset + limit]

    return {
        "total": total_count,
        "items": paginated_results
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