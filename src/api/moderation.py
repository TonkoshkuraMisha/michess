# --- FILE: src/api/moderation.py ---
"""Модерация (таск 17.4): жалобы, апелляция на флаг нечестной игры, очередь и решения модератора."""

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError
from src.db.session import get_db
from src.models.moderation import Report
from src.models.user import User
from src.services import moderation

router = APIRouter(dependencies=[Depends(rate_limit("moderation", "RATE_LIMIT_PUZZLES"))])

_CODES = {"report_not_found": status.HTTP_404_NOT_FOUND, "moderator_only": status.HTTP_403_FORBIDDEN,
          "report_duplicate": status.HTTP_409_CONFLICT}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_400_BAD_REQUEST))


class ReportIn(BaseModel):
    target: str = Field(..., max_length=50)
    kind: str = Field("player", pattern="^(player|message)$")
    reason: str = Field(..., pattern="^(cheating|abuse|spam|other)$")
    comment: str | None = Field(None, max_length=300)
    message_text: str | None = Field(None, max_length=300)
    game_id: int | None = None


class AppealIn(BaseModel):
    comment: str | None = Field(None, max_length=300)


class ResolveIn(BaseModel):
    action: str = Field(..., pattern="^(dismiss|warn|chat_ban|mark_cheater|clear_cheater)$")


def _moderator(user: User) -> None:
    if not user.is_moderator:
        raise ApiError(status.HTTP_403_FORBIDDEN, "moderator_only")


@router.get("/me")
async def my_status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Роль, отключён ли чат, есть ли флаг и открытая апелляция — для интерфейса."""
    open_appeal = await db.scalar(select(Report.id).where(
        Report.target_id == user.id, Report.kind == "appeal", Report.status == "open")) is not None
    until = user.chat_banned_until
    return {"is_moderator": user.is_moderator, "is_cheater": user.is_cheater, "open_appeal": open_appeal,
            "chat_banned_until": until.isoformat() if until and moderation.chat_banned(user) else None}


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def create_report(payload: ReportIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    target = (await db.execute(select(User).where(func.lower(User.username) == payload.target.lower()))).scalar_one_or_none()
    if target is None:
        raise ApiError(404, "user_not_found", username=payload.target)
    try:
        item = await moderation.report(db, user, target, payload.kind, payload.reason, payload.comment,
                                       payload.message_text, payload.game_id)
    except DomainError as exc:
        raise _http(exc) from None
    return {"id": item.id}


@router.post("/appeal", status_code=status.HTTP_201_CREATED)
async def create_appeal(payload: AppealIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        item = await moderation.appeal(db, user, payload.comment)
    except DomainError as exc:
        raise _http(exc) from None
    return {"id": item.id}


@router.get("/queue")
async def review_queue(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _moderator(user)
    return {"reports": await moderation.queue(db)}


@router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: int, payload: ResolveIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    try:
        item = await moderation.resolve(db, user, report_id, payload.action)
    except DomainError as exc:
        raise _http(exc) from None
    return {"id": item.id, "action": item.action}
