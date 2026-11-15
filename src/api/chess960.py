"""
Шахматы Фишера (таск 21.3): новая расстановка и ход игрока с ответом бота. Ход бота — работа движка: тот же лимит,
что у /bots/move, и правило честной игры (во время партии с человеком — 409).
"""

import asyncio

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from src.api.fair_play import forbid_engine_help_during_game
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError
from src.services import chess960 as c960
from src.services.engine_pool import EngineBusyError, EngineUnavailableError, engine_work

router = APIRouter()
BOT_DEPENDENCIES = [Depends(rate_limit("bot_move", "RATE_LIMIT_BOT_MOVE")), Depends(forbid_engine_help_during_game)]


class GameIn(BaseModel):
    number: int = Field(..., ge=0, le=959)
    moves: list[str] = Field(default_factory=list, max_length=c960.MAX_PLIES)
    level: int = Field(2, ge=1, le=len(c960.LEVELS))


class MoveIn(GameIn):
    move: str = Field(..., min_length=4, max_length=5)


def _state(game: c960.Game, bot_uci: str | None = None) -> dict:
    result, termination = c960.outcome(game.board)
    return {"number": game.number, "fen": game.board.fen(), "moves": [m.uci() for m in game.board.move_stack],
            "sans": game.sans, "result": result, "termination": termination, "bot_move": bot_uci,
            "check": game.board.is_check()}


async def _bot_reply(game: c960.Game, level: int) -> dict:
    if c960.outcome(game.board)[0] is not None:
        return _state(game)
    try:
        with engine_work("bot_move"):
            move = await asyncio.to_thread(c960.bot_move, game.board, level)
    except (EngineBusyError, EngineUnavailableError):
        raise ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, "engine_busy", headers={"Retry-After": "5"}) from None
    game.sans.append(game.board.san(move))
    game.board.push(move)
    return _state(game, move.uci())


def _replay(payload: GameIn) -> c960.Game:
    try:
        return c960.replay(payload.number, payload.moves)
    except DomainError as exc:
        raise exc.to_http(status.HTTP_400_BAD_REQUEST) from None


@router.get("/new")
async def new_game(number: int | None = Query(None, ge=0, le=959)):
    """Расстановка: номер (0–959; 518 — обычная) или случайная."""
    game = c960.replay(c960.random_number() if number is None else number, [])
    return _state(game)


@router.post("/move", dependencies=BOT_DEPENDENCIES)
async def move(payload: MoveIn):
    game = _replay(payload)
    try:
        game.sans.append(c960.push(game.board, payload.move))
    except DomainError as exc:
        raise exc.to_http(status.HTTP_400_BAD_REQUEST) from None
    return await _bot_reply(game, payload.level)


@router.post("/bot-move", dependencies=BOT_DEPENDENCIES)
async def bot_turn(payload: GameIn):
    """Ход бота в текущей позиции — когда игрок за чёрных (бот начинает)."""
    return await _bot_reply(_replay(payload), payload.level)
