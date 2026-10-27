# --- FILE: src/api/bots.py ---

import chess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.services.bots.philidor import philidor_bot

router = APIRouter()

AVAILABLE_BOTS = [
    {
        "id": "philidor",
        "name": "Франсуа-Андре Филидор",
        "era": "1749–1795",
        "title": "Мастер Просвещения",
        "rating": 1850,
        "motto": "Пешки — душа шахмат: именно они определяют атаку и защиту.",
        "avatar": "/champions/philidor.jpg",
    }
]


class BotMoveRequest(BaseModel):
    bot_id: str = Field(default="philidor", description="ID исторического бота")
    fen: str = Field(..., description="Текущая позиция на доске в формате FEN")


class BotMoveResponse(BaseModel):
    bot_id: str
    uci: str
    san: str
    fen_after: str
    source: str
    comment: str


@router.get("/list")
async def get_available_bots():
    """Возвращает список доступных исторических ботов."""
    return {"bots": AVAILABLE_BOTS}


@router.post("/move", response_model=BotMoveResponse)
async def get_bot_move(payload: BotMoveRequest):
    """Принимает FEN позиции и возвращает ответный ход выбранного исторического бота."""
    if payload.bot_id != "philidor":
        raise HTTPException(status_code=404, detail=f"Бот '{payload.bot_id}' не найден")

    try:
        board = chess.Board(payload.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректный формат FEN")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Партия уже завершена")

    result = philidor_bot.choose_move(payload.fen)
    return BotMoveResponse(
        bot_id=payload.bot_id,
        uci=result["uci"],
        san=result["san"],
        fen_after=result["fen_after"],
        source=result["source"],
        comment=result["comment"],
    )
