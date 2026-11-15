# --- FILE: src/api/mini_games.py ---
"""Игры тренеров (таск 19.8): список игр, ход игрока (и ответ бота) по правилам игры. Без рейтинга и без хранения:
позицию присылает клиент, сервер проверяет ход по правилам и подводит итог."""

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from src.api.rate_limit import rate_limit
from src.core.errors import DomainError
from src.services import mini_games as mg

router = APIRouter(dependencies=[Depends(rate_limit("mini_games", "RATE_LIMIT_PUZZLES"))])


class MoveIn(BaseModel):
    fen: str = Field(..., max_length=100)
    move: str = Field(..., min_length=4, max_length=5)
    bot: bool = True


class BotFirstIn(BaseModel):
    fen: str = Field(..., max_length=100)


def _http(exc: DomainError):
    return exc.to_http(status.HTTP_404_NOT_FOUND if exc.code == "mini_game_not_found" else status.HTTP_400_BAD_REQUEST)


def _reply(game: mg.MiniGame, board, outcome: str | None, with_bot: bool) -> dict:
    bot_uci = None
    if with_bot and outcome is None:
        move = mg.bot_move(game, board)
        if move is not None:
            bot_uci = move.uci()
            board.push(move)
            outcome = mg.result(game, board)
    return {"fen": board.fen(), "result": outcome, "bot_move": bot_uci}


@router.get("")
async def list_games():
    return {"games": [{"id": g.id, "fen": g.fen, "kings": g.kings} for g in mg.GAMES.values()]}


@router.post("/{game_id}/move")
async def make_move(game_id: str, payload: MoveIn):
    try:
        game = mg.get_game(game_id)
        board = mg.board_of(game, payload.fen)
        outcome = mg.play(game, board, payload.move)
    except DomainError as exc:
        raise _http(exc) from None
    return _reply(game, board, outcome, payload.bot)


@router.post("/{game_id}/bot-first")
async def bot_first(game_id: str, payload: BotFirstIn):
    """Игрок за чёрных: первым ходит бот."""
    try:
        game = mg.get_game(game_id)
        board = mg.board_of(game, payload.fen)
    except DomainError as exc:
        raise _http(exc) from None
    return _reply(game, board, mg.result(game, board), True)
