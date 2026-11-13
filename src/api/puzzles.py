# --- FILE: src/api/puzzles.py ---
"""
Задачи (таск 13.2): выдача, проверка хода, подсказка, «показать решение», задача дня, профиль решателя.
Защитные упражнения (таск 13.6): /defense/*.
"""

import datetime as dt

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import DomainValueError
from src.db.session import get_db
from src.models.user import User
from src.services import defense_drills, personal_puzzles
from src.services import puzzles as service

router = APIRouter(dependencies=[Depends(rate_limit("puzzles", "RATE_LIMIT_PUZZLES"))])


class TimedStartRequest(BaseModel):
    minutes: int = Field(..., description="3 или 5")


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


@router.get("/train")
async def train(
        theme: str | None = Query(default=None, max_length=40, description="Тема реестра"),
        section: str | None = Query(default=None, max_length=1, description="Раздел каталога (смешанная подборка)"),
        stage: int | None = Query(default=None, description="Ступень 1–4; по умолчанию — текущая ступень игрока"),
        blind: bool = Query(default=False, description="Не показывать темы задачи до конца решения"),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Тренировка по приёмам (таск 13.4): задача темы на ступени игрока или смешанная по разделу."""
    try:
        puzzle, chosen_stage = await service.pick_training(db, user, theme=theme, section=section, stage=stage)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    await service.start(user, puzzle, training=theme, stage=chosen_stage)
    return {**service.public_view(puzzle, show_themes=not blind), "stage": chosen_stage}


@router.get("/demo")
async def demo(theme: str = Query(..., max_length=40), user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    """Показ приёма: две задачи темы с решением (не попытка — рейтинг и история не меняются)."""
    try:
        return {"theme": theme, "examples": await service.demo_puzzles(db, theme)}
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.get("/training")
async def training(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Прогресс по всем темам: ступень, последние результаты, освоена ли, сколько задач на ступенях."""
    return await service.training_overview(db, user)


@router.get("/daily")
async def daily(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Задача дня — одна на всех (по дате UTC)."""
    try:
        puzzle = await service.daily_puzzle(db, dt.datetime.now(dt.UTC).date())
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    await service.start(user, puzzle, daily=True)
    return {**service.public_view(puzzle), "daily": True}


@router.get("/personal")
async def personal_summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """«Ваши ошибки» (таск 13.5): сколько задач к повторению сейчас, всего в работе, освоено, когда следующая."""
    return await personal_puzzles.summary(db, user)


@router.get("/personal/next")
async def personal_next(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    puzzle = await personal_puzzles.next_due(db, user)
    if puzzle is None:
        raise service.PuzzleError("no_puzzles_available", 404).to_http(404)
    return personal_puzzles.view(puzzle)


@router.post("/personal/{puzzle_id}/answer")
async def personal_answer(puzzle_id: int, payload: MoveRequest, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    try:
        return await personal_puzzles.answer(db, user, puzzle_id, payload.move)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    except DomainValueError as exc:
        raise exc.to_http(400) from exc


@router.get("/personal/game/{game_id}")
async def personal_for_game(game_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Полуходы партии, из которых сделаны задачи игрока — значок в разборе партии."""
    return {"game_id": game_id, "plies": await personal_puzzles.plies_for_game(db, game_id, user)}


class SquareRequest(BaseModel):
    square: str = Field(..., min_length=2, max_length=2, description="Поле доски, например e4")


@router.get("/defense/next")
async def defense_next(
        kind: str = Query(..., max_length=10, description="threat — «Что грозит соперник?», blunder — «Не зевни»"),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
):
    """Защитное упражнение (таск 13.6) на ступени игрока. Угроза и верные ходы не отправляются."""
    try:
        return defense_drills.public_view(await defense_drills.pick(db, user, kind))
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.post("/defense/{drill_id}/threat")
async def defense_threat(drill_id: int, payload: SquareRequest, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """«Что грозит соперник?», первый этап: поле фигуры, которая бьёт, или поле удара. Угроза раскрывается."""
    try:
        return await defense_drills.show_threat(db, user, drill_id, payload.square)
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.post("/defense/{drill_id}/answer")
async def defense_answer(drill_id: int, payload: MoveRequest, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Защита (или ход из трёх в «Не зевни»): итог, верные ходы, опровержения, прогресс темы."""
    try:
        return await defense_drills.answer(db, user, drill_id, payload.move)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    except DomainValueError as exc:
        raise exc.to_http(400) from exc


@router.post("/timed/start")
async def timed_start(payload: TimedStartRequest, user: User = Depends(get_current_user)):
    """Начать забег на время (предыдущий незаконченный отменяется)."""
    try:
        return await service.start_run(user, payload.minutes)
    except service.PuzzleError as exc:
        raise _http(exc) from exc


@router.get("/timed/next")
async def timed_next(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Следующая задача забега: сложнее с каждой решённой; рейтинг не меняет."""
    try:
        puzzle, run = await service.next_in_run(db, user)
    except service.PuzzleError as exc:
        raise _http(exc) from exc
    return {**service.public_view(puzzle), "run": run}


@router.post("/timed/finish")
async def timed_finish(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        return await service.finish_run(db, user)
    except service.PuzzleError as exc:
        raise _http(exc) from exc


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
