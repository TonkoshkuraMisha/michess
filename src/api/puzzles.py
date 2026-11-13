# --- FILE: src/api/puzzles.py ---
"""Задачи (таск 13.2): выдача, проверка хода, подсказка, «показать решение», задача дня, профиль решателя."""

import datetime as dt

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import DomainValueError
from src.db.session import get_db
from src.models.user import User
from src.services import puzzles as service

router = APIRouter(dependencies=[Depends(rate_limit("puzzles", "RATE_LIMIT_PUZZLES"))])


class MoveRequest(BaseModel):
    move: str = Field(..., min_length=4, max_length=5, description="Ход решающего в UCI")


def _http(exc: service.PuzzleError):
    return exc.to_http(exc.status)


@router.get("/next")
async def next_puzzle(
        theme: str | None = Query(default=None, max_length=40, description="Код темы реестра"),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Задача под рейтинг решателя (и по теме), без недавно решавшихся. Начинает её — предыдущая отменяется."""
    try:
        puzzle = await service.pick_puzzle(db, user, theme)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    await service.start(user, puzzle)
    return service.public_view(puzzle)


@router.get("/daily")
async def daily(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Задача дня — одна на всех (по дате UTC)."""
    try:
        puzzle = await service.daily_puzzle(db, dt.datetime.now(dt.UTC).date())
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    await service.start(user, puzzle, daily=True)
    return {**service.public_view(puzzle), "daily": True}


@router.post("/{puzzle_id}/move")
async def move(puzzle_id: int, payload: MoveRequest, user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    try:
        return await service.play(db, user, puzzle_id, payload.move)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    except DomainValueError as exc:
        raise exc.to_http(400) from exc


@router.post("/{puzzle_id}/hint")
async def hint(puzzle_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await service.hint(db, user, puzzle_id)
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.post("/{puzzle_id}/give-up")
async def give_up(puzzle_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await service.give_up(db, user, puzzle_id)
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.get("/me")
async def my_puzzles(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await service.profile(db, user)
