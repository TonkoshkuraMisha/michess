# --- FILE: src/services/notifications.py ---
"""
Центр уведомлений (таск 17.1): запись уведомления и доставка его в открытые вкладки игрока по WebSocket (событие
"notification"). Доставка — по возможности: уведомление уже в базе, и колокольчик покажет его при следующем запросе.

Данные: таблица notifications (src/models/social.py): вид, payload (параметры для текста — сам текст собирает
клиент из каталога), время прочтения. Маршруты — src/api/social.py.

Порядок в обработчиках WebSocket и фоновых задачах: ``record`` → освободить сессию базы → ``deliver`` (сеть не должна
держать соединение с базой). ``push`` делает оба шага подряд и подходит только для HTTP-обработчиков.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.social import Notification

logger = logging.getLogger(__name__)

# Виды уведомлений: вызов на партию, предложение реванша, сыгран тур турнира, ответ модератора на жалобу,
# напоминание о разминке, комментарий к публикации, напоминание о начале арены. Новый вид добавляется сюда и в
# каталоги клиента; неизвестный вид — ошибка программиста (assert в ``record``).
KINDS = ("challenge", "rematch", "tournament_round", "report_answer", "workout_reminder", "post_comment",
         "arena_reminder")
KEEP = 50  # сколько последних уведомлений отдаётся клиенту; старые записи из таблицы этот модуль не удаляет


def view(n: Notification) -> dict:
    """Уведомление в виде, который получает клиент (и в ответе API, и в событии WebSocket)."""
    created = n.created_at.isoformat() if n.created_at else None
    return {"id": n.id, "kind": n.kind, "payload": n.payload or {}, "created_at": created, "read": n.read_at is not None}


async def record(db: AsyncSession, user_id: int, kind: str, payload: dict, *, commit: bool = True) -> dict:
    """
    Записывает уведомление (без доставки); возвращает его вид для клиента. commit=False — запись остаётся в
    транзакции вызывающего кода (он сам делает commit вместе со своими изменениями).
    """
    assert kind in KINDS, kind
    notification = Notification(user_id=user_id, kind=kind, payload=payload)
    db.add(notification)
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(notification)
    return view(notification)


async def deliver(user_id: int, notification: dict) -> None:
    """Отправка в открытые вкладки — после записи и после освобождения сессии базы (правило WebSocket)."""
    try:
        from src.services.connection_manager import manager

        await manager.send_personal_message({"event": "notification", "notification": notification}, user_id)
    except Exception as exc:  # уведомление уже записано — сбой доставки не критичен
        logger.warning("Notification delivery failed for user %s: %s", user_id, exc)


async def push(db: AsyncSession, user_id: int, kind: str, payload: dict) -> dict:
    """Записать (с commit) и сразу доставить; сессия базы при этом не освобождается — см. докстринг модуля."""
    notification = await record(db, user_id, kind, payload)
    await deliver(user_id, notification)
    return notification


async def latest(db: AsyncSession, user_id: int) -> dict:
    """Последние KEEP уведомлений игрока (новые первыми) и число непрочитанных — всех, а не только среди показанных."""
    rows = (await db.execute(
        select(Notification).where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(KEEP)
    )).scalars().all()
    unread = await db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ) or 0
    return {"unread": unread, "items": [view(n) for n in rows]}


async def mark_read(db: AsyncSession, user_id: int, ids: list[int] | None) -> None:
    """Отмечает прочитанными уведомления игрока с номерами ids; без ids (None или пустой список) — все непрочитанные."""
    query = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if ids:
        query = query.where(Notification.id.in_(ids))
    await db.execute(query.values(read_at=datetime.now(UTC)))
    await db.commit()
