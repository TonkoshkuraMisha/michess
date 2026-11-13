# --- FILE: src/api/learn.py ---
"""
Школа (таск 14.1): прогресс уроков. Уроки — данные клиента, поэтому сервер принимает любой id урока в формате
слага и хранит по нему шаг, завершение и лучший результат контрольных вопросов. Прогресс только растёт: повторное
прохождение не сбрасывает пройденное, а результат экзамена хранится лучший.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.lesson import LessonProgress
from src.models.user import User

router = APIRouter()

LESSON_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{1,63}$"
MAX_STEPS = 200
MAX_EXAM_QUESTIONS = 10
# Уроки — данные клиента, и сервер не знает их списка (таск A.8): потолок записей на игрока, чтобы произвольные id не
# копились без конца. Уроков в плане — десятки.
MAX_LESSON_RECORDS = 300


class ProgressUpdate(BaseModel):
    step: int = Field(..., ge=0, lt=MAX_STEPS, description="Дальний пройденный шаг (с нуля)")
    steps_total: int = Field(..., ge=1, le=MAX_STEPS)
    completed: bool = False
    exam_score: int | None = Field(None, ge=0, le=MAX_EXAM_QUESTIONS)
    exam_total: int | None = Field(None, ge=1, le=MAX_EXAM_QUESTIONS)

    @model_validator(mode="after")
    def _consistent(self) -> "ProgressUpdate":
        if self.step >= self.steps_total:
            raise ValueError("step must be less than steps_total")
        if (self.exam_score is None) != (self.exam_total is None):
            raise ValueError("exam_score and exam_total go together")
        if self.exam_score is not None and self.exam_total is not None and self.exam_score > self.exam_total:
            raise ValueError("exam_score cannot exceed exam_total")
        return self


class ProgressOut(BaseModel):
    lesson_id: str
    step: int
    steps_total: int
    completed: bool
    exam_score: int | None
    exam_total: int | None


def _out(p: LessonProgress) -> ProgressOut:
    return ProgressOut(
        lesson_id=p.lesson_id, step=p.step, steps_total=p.steps_total, completed=p.completed_at is not None,
        exam_score=p.exam_score, exam_total=p.exam_total,
    )


@router.get("/progress", response_model=list[ProgressOut])
async def list_progress(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(LessonProgress).where(LessonProgress.user_id == user.id).order_by(LessonProgress.lesson_id)
    )).scalars().all()
    return [_out(p) for p in rows]


@router.put("/progress/{lesson_id}", response_model=ProgressOut)
async def save_progress(
        payload: ProgressUpdate,
        lesson_id: str = Path(..., pattern=LESSON_ID_PATTERN),
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
):
    progress = (await db.execute(
        select(LessonProgress).where(LessonProgress.user_id == user.id, LessonProgress.lesson_id == lesson_id)
    )).scalar_one_or_none()
    if progress is None:
        count = (await db.execute(
            select(func.count(LessonProgress.id)).where(LessonProgress.user_id == user.id)
        )).scalar_one()
        if count >= MAX_LESSON_RECORDS:
            raise ApiError(409, "lesson_progress_limit", max=MAX_LESSON_RECORDS)
        progress = LessonProgress(user_id=user.id, lesson_id=lesson_id, step=0, steps_total=payload.steps_total)
        db.add(progress)

    # Урок могли переписать (стало меньше шагов) — шаг не выходит за его длину.
    progress.steps_total = payload.steps_total
    progress.step = min(max(progress.step, payload.step), payload.steps_total - 1)
    if payload.completed and progress.completed_at is None:
        progress.completed_at = datetime.now(UTC)
    if payload.exam_score is not None and payload.exam_total is not None:
        if progress.exam_total != payload.exam_total:
            # Экзамен изменился — прежний результат к нему не относится.
            progress.exam_score, progress.exam_total = payload.exam_score, payload.exam_total
        else:
            progress.exam_score = max(progress.exam_score or 0, payload.exam_score)
    await db.commit()
    await db.refresh(progress)
    return _out(progress)
