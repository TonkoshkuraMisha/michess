# --- FILE: src/api/study.py ---
"""Совместный разбор и занятие с тренером (таск 17.3): комната (src/services/study_room.py) и материалы клуба."""

import json

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError
from src.db.session import get_db
from src.models.study import StudyMaterial
from src.models.user import User
from src.services import study_room as room

router = APIRouter(dependencies=[Depends(rate_limit("study", "RATE_LIMIT_PUZZLES"))])

MAX_LESSON_BYTES = 200_000
MAX_STEPS = 60
_CODES = {"study_room_not_found": status.HTTP_404_NOT_FOUND, "study_host_only": status.HTTP_403_FORBIDDEN}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_400_BAD_REQUEST))


class BoardIn(BaseModel):
    fen: str = Field(..., max_length=120)
    last_move: str | None = Field(None, max_length=5)
    arrows: list[dict] = Field(default_factory=list, max_length=room.MAX_ARROWS)
    highlights: list[dict] = Field(default_factory=list, max_length=room.MAX_HIGHLIGHTS)
    ghost: dict | None = None


class ChatIn(BaseModel):
    text: str = Field(..., max_length=room.MAX_TEXT)


class QuestionIn(BaseModel):
    kind: str = Field(..., pattern="^(move|choice)$")
    prompt: str = Field("", max_length=room.MAX_TEXT)
    options: list[str] = Field(default_factory=list, max_length=room.MAX_OPTIONS)
    correct: int | list[str]
    seconds: int = Field(60, ge=10, le=600)


class AnswerIn(BaseModel):
    answer: str | int


class MaterialIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    lesson: dict


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(user: User = Depends(get_current_user)):
    return await room.create(user.id, user.username)


@router.get("/materials")
async def my_materials(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(StudyMaterial).where(StudyMaterial.owner_id == user.id).order_by(StudyMaterial.id.desc())
    )).scalars().all()
    return {"materials": [{"id": m.id, "title": m.title, "created_at": m.created_at.isoformat()} for m in rows]}


@router.post("/materials", status_code=status.HTTP_201_CREATED)
async def save_material(payload: MaterialIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Занятие как урок в формате школы (таск 14.1) — материал клуба ведущего."""
    steps = payload.lesson.get("steps")
    if not isinstance(steps, list) or not steps or len(steps) > MAX_STEPS \
            or len(json.dumps(payload.lesson)) > MAX_LESSON_BYTES:
        raise ApiError(400, "study_bad_material", max=MAX_STEPS)
    material = StudyMaterial(owner_id=user.id, title=" ".join(payload.title.split()), lesson=payload.lesson)
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return {"id": material.id, "title": material.title}


@router.get("/materials/{material_id}")
async def get_material(material_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    material = await db.get(StudyMaterial, material_id)
    if material is None or material.owner_id != user.id:
        raise ApiError(404, "study_material_not_found")
    return {"id": material.id, "title": material.title, "lesson": material.lesson}


@router.get("/{code}")
async def poll_room(code: str, response: Response, since: int = Query(0, ge=0), user: User = Depends(get_current_user)):
    """Состояние комнаты; версия не изменилась — 204 без тела (участники опрашивают раз в секунду)."""
    try:
        data = await room.poll(code, user.id, user.username, since)
    except DomainError as exc:
        raise _http(exc) from None
    if data is None:
        response.status_code = status.HTTP_204_NO_CONTENT
        return None
    return data


@router.put("/{code}/board")
async def set_board(code: str, payload: BoardIn, user: User = Depends(get_current_user)):
    try:
        return await room.set_board(code, user.id, payload.model_dump())
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/chat")
async def chat(code: str, payload: ChatIn, user: User = Depends(get_current_user)):
    try:
        return await room.say(code, user.id, user.username, payload.text)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/question")
async def ask(code: str, payload: QuestionIn, user: User = Depends(get_current_user)):
    try:
        return await room.ask(code, user.id, payload.model_dump())
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/answer")
async def answer(code: str, payload: AnswerIn, user: User = Depends(get_current_user)):
    try:
        return await room.answer(code, user.id, user.username, payload.answer)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/{code}/reveal")
async def reveal(code: str, user: User = Depends(get_current_user)):
    try:
        return await room.reveal(code, user.id)
    except DomainError as exc:
        raise _http(exc) from None
