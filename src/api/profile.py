from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc

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
    """Получить историю завершенных партий пользователя."""
    user_result = await db.execute(select(User).where(User.username == username))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Ищем все завершенные игры, где пользователь был за белых или за черных
    games_query = select(Game).where(
        or_(Game.white_player_id == user.id, Game.black_player_id == user.id),
        Game.status == GameStatus.COMPLETED
    ).order_by(desc(Game.finished_at)).limit(limit).offset(offset)

    games_result = await db.execute(games_query)
    games = games_result.scalars().all()

    return [
        {
            "game_id": g.id,
            "white_id": g.white_player_id,
            "black_id": g.black_player_id,
            "status": g.status.value,
            "is_rated": g.is_rated,
            "finished_at": g.finished_at
        }
        for g in games
    ]


@router.get("/games/{game_id}/pgn")
async def download_pgn(game_id: int, db: AsyncSession = Depends(get_db)):
    """Выгрузить PGN конкретной партии в виде файла."""
    game = await db.get(Game, game_id)

    if not game or not game.pgn:
        raise HTTPException(status_code=404, detail="Game or PGN not found")

    # Отдаем PGN как текстовый файл (браузер предложит его скачать)
    headers = {
        "Content-Disposition": f"attachment; filename=michess_game_{game_id}.pgn"
    }
    return PlainTextResponse(content=game.pgn, media_type="application/x-chess-pgn", headers=headers)