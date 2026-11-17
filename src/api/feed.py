# --- FILE: src/api/feed.py ---
"""
Лента и публикации (таск 30.2): лента подписок, публикации игрока (видны и гостю — как профиль), одна публикация,
создание и удаление, «нравится», комментарии. Правила — в src/services/feed.py.
"""

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.library import optional_user
from src.api.rate_limit import rate_limit
from src.api.social import _player
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import feed, notifications

router = APIRouter(dependencies=[Depends(rate_limit("feed", "RATE_LIMIT_PUZZLES"))])

_CODES = {"post_not_found": status.HTTP_404_NOT_FOUND, "comment_not_found": status.HTTP_404_NOT_FOUND,
          "posting_banned": status.HTTP_403_FORBIDDEN, "comment_closed": status.HTTP_403_FORBIDDEN,
          "text_flagged": status.HTTP_409_CONFLICT, "posting_limited": status.HTTP_429_TOO_MANY_REQUESTS}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_400_BAD_REQUEST))


class AttachmentIn(BaseModel):
    kind: str = Field(..., pattern="^(game|position|puzzle|lesson|tournament|library|achievement)$")
    ref: str = Field(..., min_length=1, max_length=100)


class PostIn(BaseModel):
    body: str = Field("", max_length=feed.BODY_MAX * 2)
    attachment: AttachmentIn | None = None
    send_anyway: bool = False   # фильтр сработал, игрок настаивает — публикация ждёт модератора (30.3)


class CommentIn(BaseModel):
    body: str = Field(..., max_length=feed.COMMENT_MAX * 2)
    send_anyway: bool = False


@router.get("")
async def following_feed(before_id: int | None = Query(None, ge=1), db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    return {"posts": await feed.following_feed(db, user, before_id), "page": feed.PAGE}


@router.get("/user/{username}")
async def user_feed(username: str, before_id: int | None = Query(None, ge=1), db: AsyncSession = Depends(get_db),
                    viewer: User | None = Depends(optional_user)):
    author = await _player(db, username)
    return {"posts": await feed.user_feed(db, author, viewer, before_id), "page": feed.PAGE}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_post(payload: PostIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    attachment = (payload.attachment.kind, payload.attachment.ref) if payload.attachment else None
    try:
        return await feed.create(db, user, payload.body, attachment, payload.send_anyway)
    except DomainError as exc:
        raise _http(exc) from exc


@router.get("/posts/{post_id}")
async def get_post(post_id: int, db: AsyncSession = Depends(get_db), viewer: User | None = Depends(optional_user)):
    try:
        return {"post": await feed.get(db, post_id, viewer), "comments": await feed.comments(db, post_id, viewer)}
    except DomainError as exc:
        raise _http(exc) from exc


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        await feed.remove(db, post_id, user)
    except DomainError as exc:
        raise _http(exc) from exc
    return {"deleted": True}


@router.post("/posts/{post_id}/like")
async def like(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return await feed.set_like(db, post_id, user, True)
    except DomainError as exc:
        raise _http(exc) from exc


@router.delete("/posts/{post_id}/like")
async def unlike(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        return await feed.set_like(db, post_id, user, False)
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/posts/{post_id}/comments", status_code=status.HTTP_201_CREATED)
async def add_comment(post_id: int, payload: CommentIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Комментарий к публикации; автору публикации уходит уведомление (кроме своих комментариев)."""
    try:
        comment, note = await feed.add_comment(db, post_id, user, payload.body, payload.send_anyway)
    except DomainError as exc:
        raise _http(exc) from exc
    if note is not None:
        await notifications.deliver(*note)
    return comment


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        await feed.remove_comment(db, comment_id, user)
    except DomainError as exc:
        raise _http(exc) from exc
    return {"deleted": True}
