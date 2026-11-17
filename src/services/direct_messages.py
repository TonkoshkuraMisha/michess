# --- FILE: src/services/direct_messages.py ---
"""
Личные сообщения (таск 30.1): переписка двух игроков, вложения-карточки, настройка «кто может мне писать» и чёрный
список. Текст сообщения — ввод игрока; строк интерфейса сервер не хранит: карточка вложения — код вида (kind),
ссылка (ref) и снимок данных на момент отправки (имена игроков, результат, рейтинг задачи), подписи собирает клиент.

Доставка в открытые вкладки — событие WebSocket "direct_message" после записи и коммита (правило WebSocket: сеть —
после освобождения базы; здесь HTTP, но порядок тот же: сообщение уже в базе, доставка — по возможности).
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.social import Block, DirectMessage, Follow
from src.models.user import User
from src.services import moderation
from src.services.attachments import build_attachment, clean_text

logger = logging.getLogger(__name__)

POLICIES = ("all", "following", "nobody")
BODY_MAX = 1000
PAGE = 50
CONVERSATIONS = 50


def pair_key(a: int, b: int) -> str:
    low, high = sorted((a, b))
    return f"{low}:{high}"


def clean_body(text: str | None) -> str:
    return clean_text(text, BODY_MAX)


async def is_blocked(db: AsyncSession, blocker_id: int, blocked_id: int) -> bool:
    found = await db.scalar(select(Block.id).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id))
    return found is not None


async def check_write(db: AsyncSession, sender: User, recipient: User) -> None:
    """Можно ли sender писать recipient; нельзя — DomainError с кодом причины. Чёрный список получателя
    отвечает тем же dm_closed, что и закрытая настройка: заблокированный не узнаёт, что его заблокировали."""
    if sender.id == recipient.id:
        raise DomainError("cannot_message_self")
    if moderation.chat_banned(sender):
        raise DomainError("dm_chat_banned")
    if await is_blocked(db, sender.id, recipient.id):
        raise DomainError("dm_you_blocked")
    policy = recipient.dm_policy or "all"
    closed = policy == "nobody" or await is_blocked(db, recipient.id, sender.id)
    if not closed and policy == "following":
        closed = await db.scalar(select(Follow.id).where(Follow.follower_id == recipient.id,
                                                         Follow.followee_id == sender.id)) is None
    if closed:
        raise DomainError("dm_closed")


async def write_refusal(db: AsyncSession, sender: User, recipient: User) -> str | None:
    """None — можно писать; иначе код причины."""
    try:
        await check_write(db, sender, recipient)
    except DomainError as exc:
        return exc.code
    return None


def view(message: DirectMessage, me_id: int) -> dict:
    created = message.created_at.isoformat() if message.created_at else None
    return {"id": message.id, "mine": message.sender_id == me_id, "body": message.body,
            "attachment": message.attachment, "created_at": created, "read": message.read_at is not None}


async def send(db: AsyncSession, sender: User, recipient: User, body: str | None,
               attachment: tuple[str, str] | None) -> DirectMessage:
    await check_write(db, sender, recipient)
    text = clean_body(body)
    card = await build_attachment(db, *attachment, author=sender) if attachment else None
    if not text and card is None:
        raise DomainError("dm_empty")
    message = DirectMessage(pair_key=pair_key(sender.id, recipient.id), sender_id=sender.id,
                            recipient_id=recipient.id, body=text, attachment=card)
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


async def deliver(message: DirectMessage, sender_name: str) -> None:
    """Открытые вкладки получателя и другие вкладки отправителя."""
    try:
        from src.services.connection_manager import manager

        payload = view(message, message.recipient_id)
        await manager.send_personal_message({"event": "direct_message", "from": sender_name, "message": payload},
                                            message.recipient_id)
    except Exception as exc:  # сообщение уже записано — сбой доставки не критичен
        logger.warning("Direct message delivery failed for user %s: %s", message.recipient_id, exc)


async def thread(db: AsyncSession, me: User, other: User, before_id: int | None = None) -> list[dict]:
    """Последние PAGE сообщений переписки (старые — первыми); before_id — страница раньше."""
    query = select(DirectMessage).where(DirectMessage.pair_key == pair_key(me.id, other.id))
    if before_id:
        query = query.where(DirectMessage.id < before_id)
    rows = (await db.execute(query.order_by(DirectMessage.id.desc()).limit(PAGE))).scalars().all()
    return [view(m, me.id) for m in reversed(rows)]


async def mark_read(db: AsyncSession, me: User, other: User) -> None:
    await db.execute(update(DirectMessage).where(
        DirectMessage.pair_key == pair_key(me.id, other.id), DirectMessage.recipient_id == me.id,
        DirectMessage.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    await db.commit()


async def unread_total(db: AsyncSession, me_id: int) -> int:
    return await db.scalar(select(func.count()).select_from(DirectMessage).where(
        DirectMessage.recipient_id == me_id, DirectMessage.read_at.is_(None))) or 0


async def conversations(db: AsyncSession, me: User) -> list[dict]:
    """Собеседники: последнее сообщение, сколько непрочитанных; свежие — первыми."""
    mine = or_(DirectMessage.sender_id == me.id, DirectMessage.recipient_id == me.id)
    last_ids = (await db.execute(
        select(func.max(DirectMessage.id)).where(mine).group_by(DirectMessage.pair_key)
        .order_by(func.max(DirectMessage.id).desc()).limit(CONVERSATIONS)
    )).scalars().all()
    if not last_ids:
        return []
    lasts = (await db.execute(select(DirectMessage).where(DirectMessage.id.in_(last_ids))
                              .order_by(DirectMessage.id.desc()))).scalars().all()
    unread: dict[int, int] = {sender: count for sender, count in (await db.execute(
        select(DirectMessage.sender_id, func.count()).where(
            DirectMessage.recipient_id == me.id, DirectMessage.read_at.is_(None)).group_by(DirectMessage.sender_id)
    )).all()}
    others = {m.recipient_id if m.sender_id == me.id else m.sender_id for m in lasts}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(others)))).scalars().all()}
    blocked = set((await db.execute(select(Block.blocked_id).where(
        Block.blocker_id == me.id, Block.blocked_id.in_(others)))).scalars().all())
    out = []
    for m in lasts:
        other_id = m.recipient_id if m.sender_id == me.id else m.sender_id
        other = users.get(other_id)
        if other is None or other.deleted_at is not None:
            continue
        out.append({"username": other.username, "avatar": other.avatar, "last": view(m, me.id),
                    "unread": unread.get(other_id, 0), "blocked": other_id in blocked})
    return out


async def block(db: AsyncSession, me: User, other: User) -> None:
    if me.id == other.id:
        raise DomainError("cannot_block_self")
    if not await is_blocked(db, me.id, other.id):
        db.add(Block(blocker_id=me.id, blocked_id=other.id))
        await db.commit()


async def unblock(db: AsyncSession, me: User, other: User) -> None:
    await db.execute(delete(Block).where(Block.blocker_id == me.id, Block.blocked_id == other.id))
    await db.commit()


async def blocked_list(db: AsyncSession, me: User) -> list[str]:
    rows = await db.execute(select(User.username).join(Block, Block.blocked_id == User.id)
                            .where(Block.blocker_id == me.id).order_by(User.username))
    return list(rows.scalars().all())
