# --- FILE: src/api/beta.py ---
"""
Программа беты (таск 24.4): настройки сайта для клиента, проверка кода-приглашения, «Сообщить о проблеме» и
работа модератора с приглашениями и сообщениями.

Открытые адреса (без входа): /beta/config, /beta/invites/check, POST /beta/feedback — каждый со своим лимитом
запросов. Остальное — только модератору.
"""

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import optional_user_id
from src.api.rate_limit import client_identity, client_ip, enforce_rate_limit
from src.core.config import settings
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import beta

router = APIRouter()

_CODES = {"moderator_only": status.HTTP_403_FORBIDDEN, "beta_invite_not_found": status.HTTP_404_NOT_FOUND,
          "feedback_not_found": status.HTTP_404_NOT_FOUND}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_400_BAD_REQUEST))


class InviteIn(BaseModel):
    note: str | None = Field(None, max_length=100)
    max_uses: int | None = Field(None, ge=1, le=beta.MAX_USES)
    expires_in_days: int | None = Field(None, ge=1, le=beta.MAX_EXPIRES_DAYS)


class FeedbackIn(BaseModel):
    message: str = Field(..., min_length=beta.MESSAGE_MIN, max_length=beta.MESSAGE_MAX)
    page: str | None = Field(None, max_length=200)
    language: str | None = Field(None, max_length=8)
    screen: str | None = Field(None, max_length=20, pattern=r"^\d{1,5}x\d{1,5}$")


class FeedbackStatusIn(BaseModel):
    status: str = Field(..., pattern="^(new|in_progress|done|rejected)$")


@router.get("/config")
async def site_config():
    """Что клиенту нужно знать до входа: закрыта ли регистрация, ссылка на сообщество, версия приложения."""
    return {"invite_only": settings.REGISTRATION_INVITE_ONLY, "community_url": beta.community_url(),
            "version": settings.VERSION}


@router.get("/invites/check")
async def check_invite(request: Request, code: str = Query(..., min_length=1, max_length=beta.MAX_CODE_LENGTH),
                       db: AsyncSession = Depends(get_db)):
    """Подсказка для формы регистрации: действует ли код. Сам код при этом не тратится."""
    await enforce_rate_limit("invite_check", f"ip:{client_ip(request)}", settings.RATE_LIMIT_INVITE_CHECK,
                             settings.RATE_LIMIT_WINDOW_S, "too_many_invite_checks")
    return {"valid": await beta.invite_usable(db, code)}


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
async def send_feedback(payload: FeedbackIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Сообщение о проблеме — от игрока или гостя."""
    await enforce_rate_limit("feedback", client_identity(request), settings.RATE_LIMIT_FEEDBACK,
                             settings.RATE_LIMIT_FEEDBACK_WINDOW_S, "too_many_feedback")
    try:
        item = await beta.submit_feedback(db, await optional_user_id(request, db), payload.message, payload.page,
                                          payload.language, payload.screen)
    except DomainError as exc:
        raise _http(exc) from None
    return {"id": item.id}


@router.get("/invites")
async def invites(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return {"invite_only": settings.REGISTRATION_INVITE_ONLY, "invites": await beta.list_invites(db, user)}
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(payload: InviteIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return await beta.create_invite(db, user, payload.note, payload.max_uses, payload.expires_in_days)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/invites/{invite_id}/revoke")
async def revoke_invite(invite_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return await beta.revoke_invite(db, user, invite_id)
    except DomainError as exc:
        raise _http(exc) from None


@router.get("/feedback")
async def feedback_queue(status_filter: str | None = Query(None, alias="status", pattern="^(new|in_progress|done|rejected)$"),
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return await beta.feedback_queue(db, user, status_filter)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("/feedback/{feedback_id}/status")
async def set_feedback_status(feedback_id: int, payload: FeedbackStatusIn, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    try:
        item = await beta.set_feedback_status(db, user, feedback_id, payload.status)
    except DomainError as exc:
        raise _http(exc) from None
    return {"id": item.id, "status": item.status}
