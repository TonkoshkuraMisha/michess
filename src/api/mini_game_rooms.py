# --- FILE: src/api/mini_game_rooms.py ---
"""
Игры тренеров с человеком по сети (таск 19.8): комната на двоих по ссылке. Правила комнаты — src/services/
mini_game_rooms.py, правила игр — src/services/mini_games.py. Создать, войти, ходить, сдаться и «ещё раз» — только
вошедшим (лимит — как у задач); смотреть комнату (GET, его клиент повторяет раз в секунду) может любой — без лимита.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import optional_user_id
from src.api.rate_limit import rate_limit
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import mini_game_rooms as service

router = APIRouter()
_LIMIT = Depends(rate_limit("mini_rooms", "RATE_LIMIT_PUZZLES"))
# Статусы HTTP для кодов отказа; остальные — 409 (конфликт с состоянием комнаты).
_CODES = {
    "mini_room_not_found": status.HTTP_404_NOT_FOUND, "mini_game_not_found": status.HTTP_404_NOT_FOUND,
    "mini_room_not_player": status.HTTP_403_FORBIDDEN, "mini_game_illegal_move": status.HTTP_400_BAD_REQUEST,
    "mini_game_bad_position": status.HTTP_400_BAD_REQUEST,
}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_409_CONFLICT))


class CreateIn(BaseModel):
    game_id: str = Field(..., max_length=32)
    color: Literal["white", "black", "random"] = "random"


class MoveIn(BaseModel):
    move: str = Field(..., min_length=4, max_length=5)
    # Версия комнаты, на которой игрок увидел позицию: устаревший ход не применяется.
    version: int = Field(..., ge=0)


@router.post("", dependencies=[_LIMIT])
async def create_room(payload: CreateIn, user: User = Depends(get_current_user)):
    """Новая комната: создатель за выбранным цветом, ссылку на /train/games/room/{code} он отправляет сопернику."""
    try:
        return await service.create(user, payload.game_id, payload.color)
    except DomainError as exc:
        raise _http(exc) from None


@router.get("/{code}")
async def get_room(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Комната: позиция, ходы, игроки, итог и цвет запросившего. Открыта всем — по ней же следит за игрой страница."""
    try:
        return await service.get(code, await optional_user_id(request, db))
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/join", dependencies=[_LIMIT])
async def join_room(code: str, user: User = Depends(get_current_user)):
    try:
        return await service.join(user, code)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/move", dependencies=[_LIMIT])
async def move(code: str, payload: MoveIn, user: User = Depends(get_current_user)):
    try:
        return await service.move(user, code, payload.move, payload.version)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/resign", dependencies=[_LIMIT])
async def resign(code: str, user: User = Depends(get_current_user)):
    try:
        return await service.resign(user, code)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/rematch", dependencies=[_LIMIT])
async def rematch(code: str, user: User = Depends(get_current_user)):
    try:
        return await service.rematch(user, code)
    except DomainError as exc:
        raise _http(exc) from None
