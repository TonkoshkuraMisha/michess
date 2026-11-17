# --- FILE: src/api/messages.py ---
"""
Личные сообщения (таск 30.1): список переписок, переписка с игроком, отправка (текст и/или карточка партии, позиции,
задачи, урока, турнира), прочитано, настройка «кто может мне писать» и чёрный список.
"""

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.api.social import _player
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import direct_messages as dm

router = APIRouter(dependencies=[Depends(rate_limit("messages", "RATE_LIMIT_PUZZLES"))])

_CODES = {"dm_closed": status.HTTP_403_FORBIDDEN, "dm_you_blocked": status.HTTP_403_FORBIDDEN,
          "dm_chat_banned": status.HTTP_403_FORBIDDEN}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_400_BAD_REQUEST))


class AttachmentIn(BaseModel):
    kind: str = Field(..., pattern="^(game|position|puzzle|lesson|tournament|library)$")
    ref: str = Field(..., min_length=1, max_length=100)


class MessageIn(BaseModel):
    body: str = Field("", max_length=dm.BODY_MAX * 2)
    attachment: AttachmentIn | None = None


class SettingsIn(BaseModel):
    dm_policy: str = Field(..., pattern="^(all|following|nobody)$")


@router.get("")
async def list_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"conversations": await dm.conversations(db, user), "unread": await dm.unread_total(db, user.id)}


@router.get("/unread")
async def unread(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"unread": await dm.unread_total(db, user.id)}


@router.get("/with/{username}")
async def conversation(username: str, before_id: int | None = Query(None, ge=1), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Переписка (старые сообщения — первыми) и можно ли сейчас писать (иначе — код причины)."""
    other = await _player(db, username)
    reason = await dm.write_refusal(db, user, other)
    return {"username": other.username, "avatar": other.avatar,
            "messages": await dm.thread(db, user, other, before_id),
            "can_write": reason is None, "reason": reason,
            "blocked": await dm.is_blocked(db, user.id, other.id)}


@router.post("/with/{username}")
async def send_message(username: str, payload: MessageIn, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    other = await _player(db, username)
    attachment = (payload.attachment.kind, payload.attachment.ref) if payload.attachment else None
    try:
        message = await dm.send(db, user, other, payload.body, attachment)
    except DomainError as exc:
        raise _http(exc) from exc
    await dm.deliver(message, user.username)
    return dm.view(message, user.id)


@router.post("/with/{username}/read")
async def read(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    other = await _player(db, username)
    await dm.mark_read(db, user, other)
    return {"unread": await dm.unread_total(db, user.id)}


@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"dm_policy": user.dm_policy or "all", "blocked": await dm.blocked_list(db, user)}


@router.put("/settings")
async def put_settings(payload: SettingsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    user.dm_policy = payload.dm_policy
    await db.commit()
    return await get_settings(db, user)


@router.post("/block/{username}")
async def block(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    other = await _player(db, username)
    try:
        await dm.block(db, user, other)
    except DomainError as exc:
        raise _http(exc) from exc
    return await get_settings(db, user)


@router.delete("/block/{username}")
async def unblock(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    other = await _player(db, username)
    await dm.unblock(db, user, other)
    return await get_settings(db, user)
