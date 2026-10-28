# --- FILE: src/api/bots.py ---

import chess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.services.bots.labourdonnais import labourdonnais_bot
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
    },
    {
        "id": "labourdonnais",
        "name": "Луи-Шарль Лабурдонне",
        "era": "1795–1840",
        "title": "Король Комбинаций",
        "rating": 1950,
        "motto": "Инициатива, гамбит и стремительная атака на короля!",
        "avatar": "/champions/labourdonnais.jpg",
    },
]

BOT_INSTANCES = {
    "philidor": philidor_bot,
    "labourdonnais": labourdonnais_bot,
}


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
    bot = BOT_INSTANCES.get(payload.bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail=f"Бот '{payload.bot_id}' не найден")

    try:
        board = chess.Board(payload.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректный формат FEN")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="Партия уже завершена")

    result = bot.choose_move(payload.fen)
    return BotMoveResponse(
        bot_id=payload.bot_id,
        uci=result["uci"],
        san=result["san"],
        fen_after=result["fen_after"],
        source=result["source"],
        comment=result["comment"],
    )
