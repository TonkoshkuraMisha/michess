# --- FILE: src/api/profile.py ---

import re
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
    """Получить данные своего профиля."""
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
    """Получить топ игроков по рейтингу (без читеров)."""
    query = select(User).where(
        User.is_cheater == False
    ).order_by(desc(User.rating)).limit(limit)

    result = await db.execute(query)
    top_users = result.scalars().all()

    return [
        {
            "rank": index + 1,
            "username": user.username,
            "rating": user.rating
        }
        for index, user in enumerate(top_users)
    ]


@router.get("/{username}")
async def get_user_profile(username: str, db: AsyncSession = Depends(get_db)):
    """Получить публичный профиль любого игрока по юзернейму."""
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()

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
        limit: int = Query(20, ge=1, le=100, description="Количество игр на страницу"),
        offset: int = Query(0, ge=0, description="Смещение для пагинации"),
        db: AsyncSession = Depends(get_db)
):
    """Получить историю завершенных партий пользователя с данными оппонентов."""
    user_result = await db.execute(select(User).where(User.username == username))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    WhiteUser = aliased(User)
    BlackUser = aliased(User)

    # Используем JOIN для получения никнеймов и рейтингов обоих игроков
    games_query = (
        select(Game, WhiteUser.username, WhiteUser.rating, BlackUser.username, BlackUser.rating)
        .join(WhiteUser, Game.white_player_id == WhiteUser.id)
        .join(BlackUser, Game.black_player_id == BlackUser.id)
        .where(
            or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
            Game.status == GameStatus.COMPLETED
        )
        .order_by(desc(Game.finished_at))
        .limit(limit)
        .offset(offset)
    )

    games_result = await db.execute(games_query)
    rows = games_result.all()

    results = []
    for game, w_name, w_rating, b_name, b_rating in rows:
        result_str = "*"
        if game.pgn:
            # Извлекаем результат напрямую из заголовков PGN
            match = re.search(r'\[Result\s+"(.*?)"\]', game.pgn)
            if match:
                result_str = match.group(1)

        results.append({
            "game_id": game.id,
            "white_username": w_name,
            "white_rating": w_rating,
            "black_username": b_name,
            "black_rating": b_rating,
            "status": game.status.value,
            "is_rated": game.is_rated,
            "result": result_str,
            "finished_at": game.finished_at
        })

    return results


@router.get("/games/{game_id}/pgn")
async def download_pgn(game_id: int, db: AsyncSession = Depends(get_db)):
    """Выгрузить PGN конкретной партии в виде файла."""
    game = await db.get(Game, game_id)

    if not game or not game.pgn:
        raise HTTPException(status_code=404, detail="Game or PGN not found")

    headers = {
        "Content-Disposition": f"attachment; filename=michess_game_{game_id}.pgn"
    }
    return PlainTextResponse(content=game.pgn, media_type="application/x-chess-pgn", headers=headers)


@router.get("/matchmaking/queue")
async def get_matchmaking_queue():
    """Получить список игроков, находящихся в очереди поиска."""
    from src.services.matchmaker import matchmaker
    players = await matchmaker.get_queue_players()
    return players