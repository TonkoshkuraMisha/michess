"""Диагностический экзамен (таск 22.0): вопросы теста, проверка ответов, последние итоги."""

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


class Answer(BaseModel):
    id: int = Field(..., ge=1)
    move: str = Field(..., min_length=4, max_length=5)


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


@router.post("/{section}/submit")
async def submit(payload: SubmitIn, section: str = Section, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    try:
        graded = await exam.grade(db, user.id, section, [(a.id, a.move) for a in payload.answers])
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return {"section": graded.section, "correct": graded.correct, "total": graded.total, "estimate": graded.estimate,
            "level": exam.level(graded.estimate), "review": graded.review, "branches": graded.branches}
