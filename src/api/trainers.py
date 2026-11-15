# --- FILE: src/api/trainers.py ---
"""
Тренажёры (таск 19.1): запись результата попытки, личные рекорды и история для графика. Тренажёры считаются на
клиенте, поэтому сервер только проверяет границы значений: рекорды — личные, на рейтинг они не влияют.
"""

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.trainer import TrainerResult
from src.models.user import User

router = APIRouter(dependencies=[Depends(rate_limit("trainers", "RATE_LIMIT_PUZZLES"))])

# Известные тренажёры: «Тихая тропа», «Двойной удар», «Маршрут коня», «Хвост» (таск 16.5); новые (спринт 19) — сюда же.
TRAINERS = ("quiet_path", "double_strike", "knight_route", "tail")
MAX_LEVEL = 20
HISTORY = 50


class ResultIn(BaseModel):
    trainer: str = Field(..., max_length=32)
    level: int = Field(..., ge=1, le=MAX_LEVEL)
    score: int = Field(..., ge=0, le=100_000)
    time_ms: int = Field(..., ge=0, le=3_600_000)
    mistakes: int = Field(0, ge=0, le=1_000)


def _check(trainer: str) -> None:
    if trainer not in TRAINERS:
        raise ApiError(404, "trainer_not_found", trainer=trainer)


async def _best(db: AsyncSession, user_id: int, trainer: str, level: int | None = None) -> int | None:
    query = select(func.max(TrainerResult.score)).where(TrainerResult.user_id == user_id, TrainerResult.trainer == trainer)
    if level is not None:
        query = query.where(TrainerResult.level == level)
    return await db.scalar(query)


@router.post("/results")
async def save_result(payload: ResultIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Результат попытки; record — побит ли личный рекорд уровня."""
    _check(payload.trainer)
    previous = await _best(db, user.id, payload.trainer, payload.level)
    db.add(TrainerResult(user_id=user.id, **payload.model_dump()))
    await db.commit()
    return {"record": previous is None or payload.score > previous,
            "best": max(payload.score, previous or 0)}


@router.get("/records")
async def records(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """По каждому тренажёру: лучший результат, самый высокий пройденный уровень, число попыток."""
    rows = (await db.execute(
        select(TrainerResult.trainer, func.max(TrainerResult.score), func.max(TrainerResult.level), func.count())
        .where(TrainerResult.user_id == user.id).group_by(TrainerResult.trainer)
    )).all()
    return {"records": {trainer: {"best": best, "max_level": level, "attempts": count}
                        for trainer, best, level, count in rows}}


@router.get("/history/{trainer}")
async def history(trainer: str = Path(..., max_length=32), db: AsyncSession = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """Последние результаты тренажёра — для графика (старые первыми)."""
    _check(trainer)
    rows = (await db.execute(
        select(TrainerResult).where(TrainerResult.user_id == user.id, TrainerResult.trainer == trainer)
        .order_by(TrainerResult.created_at.desc(), TrainerResult.id.desc()).limit(HISTORY)
    )).scalars().all()
    return {"results": [{"level": r.level, "score": r.score, "time_ms": r.time_ms, "mistakes": r.mistakes,
                         "created_at": r.created_at.isoformat()} for r in reversed(rows)]}
