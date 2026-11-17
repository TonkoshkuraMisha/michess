"""Диагностический экзамен (таск 22.0): вопросы теста, проверка ответов, последние итоги."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import exam, level_exam

router = APIRouter(dependencies=[Depends(rate_limit("exam", "RATE_LIMIT_PUZZLES"))])
Section = Path(..., max_length=10)


UciMove = Annotated[str, Field(min_length=4, max_length=5)]
MAX_LINE = 20


class Answer(BaseModel):
    """Ответ на позицию: ходы игрока по порядку (moves); move — прежний формат «один ход»."""
    id: int = Field(..., ge=1)
    move: UciMove | None = None
    moves: list[UciMove] | None = Field(None, max_length=MAX_LINE)

    def played(self) -> list[str]:
        return self.moves if self.moves is not None else [self.move] if self.move else []


class MoveIn(BaseModel):
    id: int = Field(..., ge=1)
    moves: list[UciMove] = Field(..., min_length=1, max_length=MAX_LINE)


class SubmitIn(BaseModel):
    answers: list[Answer] = Field(..., min_length=1, max_length=exam.ENDGAME_QUESTIONS)


def _http(exc: DomainError):
    return exc.to_http(404 if exc.code in ("exam_section_unknown", "exam_section_empty") else 400)


@router.get("")
async def results(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    latest = await exam.latest(db, user.id)
    return {"tests": [*exam.EXAM_SECTIONS, exam.ENDGAME], "level_tests": level_exam.sections(),
            "results": latest["sections"], "overall": latest["overall"],
            "level": latest["level"], "passed": latest["passed"], "of": latest["of"]}


@router.get("/{section}/questions")
async def questions(section: str = Section, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return {"section": section, "questions": await exam.build(db, section)}
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{section}/move")
async def move(payload: MoveIn, section: str = Section, db: AsyncSession = Depends(get_db),
               user: User = Depends(get_current_user)):
    """
    Ход во время теста: верен ли он, чем отвечает соперник и закончена ли позиция. Решение доигрывается до конца —
    за каждый верный ход очко; ошибка заканчивает позицию.
    """
    try:
        progress = await exam.check_moves(db, section, payload.id, payload.moves)
    except DomainError as exc:
        raise _http(exc) from None
    return {"correct": not progress.failed, "reply": progress.reply, "done": progress.failed or progress.solved,
            "solved": progress.solved, "points": progress.correct, "max_points": progress.total}


@router.post("/{section}/submit")
async def submit(payload: SubmitIn, section: str = Section, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """
    Сдача экзамена раздела: ответы проверяются на сервере; возвращаются число верных, оценка силы, уровень, разбор по
    позициям и очки за ходы.
    """
    try:
        graded = await exam.grade(db, user.id, section, [(a.id, a.played()) for a in payload.answers])
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return {"section": graded.section, "correct": graded.correct, "total": graded.total, "estimate": graded.estimate,
            "level": exam.level(graded.estimate), "review": graded.review, "branches": graded.branches,
            "points": graded.points, "max_points": graded.max_points}
