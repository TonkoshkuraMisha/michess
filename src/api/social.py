# --- FILE: src/api/social.py ---
"""
Игроки и уведомления (таск 17.1): поиск игрока, подписки (взаимные — «друзья»), кто в сети, прямой вызов и центр
уведомлений. Вызов: на главной доске игрок создаёт приватное приглашение (WebSocket create_invite), а здесь оно
превращается в уведомление для соперника — тот принимает его по ссылке /challenge/<код>.
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.social import Follow
from src.models.user import User
from src.services import notifications
from src.services.connection_manager import manager
from src.services.matchmaker import matchmaker

router = APIRouter(dependencies=[Depends(rate_limit("social", "RATE_LIMIT_PUZZLES"))])

ARCHIVE_PASSWORD = "!historical_archive_no_login!"
SEARCH_LIMIT = 10


def _real_players():
    """Живые игроки: не боты, не архив мастеров, не удалённые."""
    return (User.is_bot.is_(False), User.hashed_password != ARCHIVE_PASSWORD, User.deleted_at.is_(None))


async def _player(db: AsyncSession, username: str) -> User:
    query = select(User).where(func.lower(User.username) == username.lower(), *_real_players())
    user = (await db.execute(query)).scalar_one_or_none()
    if user is None:
        raise ApiError(404, "user_not_found", username=username)
    return user


async def _card(user: User) -> dict:
    return {"username": user.username, "online": await manager.is_user_online(user.id),
            "blitz_rating": user.blitz_rating, "rapid_rating": user.rapid_rating}


@router.get("/search")
async def search(q: str = Query(..., min_length=2, max_length=30), db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Игроки, чьё имя начинается с q (без учёта регистра); сначала точное совпадение."""
    prefix = q.strip().lower()
    rows = (await db.execute(
        select(User).where(func.lower(User.username).like(f"{prefix}%"), User.id != user.id, *_real_players())
        .order_by(func.length(User.username), User.username).limit(SEARCH_LIMIT)
    )).scalars().all()
    return {"players": [await _card(u) for u in rows]}


@router.post("/follow/{username}")
async def follow(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    target = await _player(db, username)
    if target.id == user.id:
        raise ApiError(400, "cannot_follow_self")
    exists = await db.scalar(select(Follow.id).where(Follow.follower_id == user.id, Follow.followee_id == target.id))
    if exists is None:
        db.add(Follow(follower_id=user.id, followee_id=target.id))
        await db.commit()
    return await relation(username, db, user)


@router.delete("/follow/{username}")
async def unfollow(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    target = await _player(db, username)
    await db.execute(delete(Follow).where(Follow.follower_id == user.id, Follow.followee_id == target.id))
    await db.commit()
    return await relation(username, db, user)


@router.get("/relation/{username}")
async def relation(username: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Подписан ли я, подписан ли он на меня (вместе — «друзья») и в сети ли он."""
    target = await _player(db, username)
    following = await db.scalar(select(Follow.id).where(Follow.follower_id == user.id, Follow.followee_id == target.id))
    followed_by = await db.scalar(select(Follow.id).where(Follow.follower_id == target.id, Follow.followee_id == user.id))
    return {"username": target.username, "self": target.id == user.id,
            "following": following is not None, "followed_by": followed_by is not None,
            "friends": following is not None and followed_by is not None,
            "online": await manager.is_user_online(target.id)}


@router.get("/following")
async def following_list(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """На кого я подписан — с отметкой «в сети» и «друг»; сначала те, кто в сети."""
    rows = (await db.execute(
        select(User).join(Follow, Follow.followee_id == User.id).where(Follow.follower_id == user.id).order_by(User.username)
    )).scalars().all()
    mutual = set((await db.execute(
        select(Follow.follower_id).where(Follow.followee_id == user.id)
    )).scalars().all())
    players = [{**await _card(u), "friend": u.id in mutual} for u in rows]
    players.sort(key=lambda p: (not p["online"], p["username"].lower()))
    return {"players": players}


class ChallengeIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=16)


@router.post("/challenge/{username}")
async def challenge(username: str, payload: ChallengeIn, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    """Прямой вызов: своё приватное приглашение (код) уходит сопернику уведомлением."""
    target = await _player(db, username)
    if target.id == user.id:
        raise ApiError(400, "cannot_challenge_self")
    invite = await matchmaker.get_private_invite(payload.code)
    if not invite or int(invite.get("creator_id", 0)) != user.id:
        raise ApiError(404, "invite_invalid")
    await notifications.push(db, target.id, "challenge", {
        "from": user.username, "code": payload.code, "base_time_ms": invite.get("base_time_ms"),
        "increment_ms": invite.get("increment_ms"), "rated": bool(invite.get("rated")),
    })
    return {"sent": True, "online": await manager.is_user_online(target.id)}


@router.get("/notifications")
async def list_notifications(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await notifications.latest(db, user.id)


class ReadIn(BaseModel):
    ids: list[int] | None = Field(None, max_length=100, description="Пусто — прочитать все")


@router.post("/notifications/read")
async def read_notifications(payload: ReadIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await notifications.mark_read(db, user.id, payload.ids)
    return await notifications.latest(db, user.id)
