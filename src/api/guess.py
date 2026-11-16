# --- FILE: src/api/guess.py ---
"""«Угадай ход мастера» (таск 14.3): позиции из партий мастеров, отобранные движком; ответ оценивается в баллах."""

import chess
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.fair_play import optional_user_id
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.guess import GuessPosition
from src.models.user import User
from src.services import guess as guess_service

router = APIRouter(dependencies=[Depends(rate_limit("guess", "RATE_LIMIT_PUZZLES"))])

DEFAULT_TARGET = 1500
MAX_GAMES = 100


class AnswerRequest(BaseModel):
    move: str = Field(..., min_length=4, max_length=5, description="Ход игрока в UCI")


async def _position(db: AsyncSession, position_id: int) -> GuessPosition:
    position = await db.get(GuessPosition, position_id)
    if position is None:
        raise ApiError(404, "guess_position_not_found")
    return position


@router.get("/next")
async def next_position(
        request: Request,
        series: bool = Query(default=False, description="Начало серии ходов из партии"),
        db: AsyncSession = Depends(get_db),
):
    """Следующая позиция около силы игрока (рейтинг задач; гостю — 1500). Пусто — позиции ещё не отобраны."""
    user_id = await optional_user_id(request, db)
    user = await db.get(User, user_id) if user_id else None
    target = user.puzzle_rating if user else DEFAULT_TARGET
    position = await guess_service.pick_position(db, target, series)
    return {"position": await guess_service.payload(db, position) if position else None}


@router.get("/position/{position_id}")
async def get_position(position_id: int, db: AsyncSession = Depends(get_db)):
    return await guess_service.payload(db, await _position(db, position_id))


@router.get("/game/{game_id}")
async def positions_of_game(game_id: int, db: AsyncSession = Depends(get_db)):
    """Отобранные моменты партии — для кнопки «Угадай ход» в просмотре партии; пустой список — кнопки нет."""
    positions = await guess_service.game_positions(db, game_id)
    return {"positions": [{"id": p.id, "ply": p.ply, "series_id": p.series_id} for p in positions]}


@router.get("/games")
async def games_with_positions(
        ids: str = Query(..., max_length=2000, description="id партий через запятую"),
        db: AsyncSession = Depends(get_db),
):
    """Какие из партий имеют отобранные моменты: {game_id: id первой позиции} (до MAX_GAMES партий за запрос)."""
    game_ids = [int(part) for part in ids.split(",") if part.strip().isdigit()][:MAX_GAMES]  # прочее — пропуск
    found = await guess_service.first_positions(db, game_ids)
    return {"games": {str(game_id): position_id for game_id, position_id in found.items()}}


@router.post("/position/{position_id}/answer")
async def answer(position_id: int, payload: AnswerRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Ответ игрока; ответ вошедшего игрока меняет рейтинг позиции (src/services/guess.py)."""
    position = await _position(db, position_id)
    board = chess.Board(position.fen)
    try:
        move = chess.Move.from_uci(payload.move)
    except ValueError:
        move = None
    if move is None or move not in board.legal_moves:
        raise ApiError(400, "illegal_move", move=payload.move)
    user_id = await optional_user_id(request, db)
    user = await db.get(User, user_id) if user_id else None
    return await guess_service.answer(db, position, payload.move, user)
