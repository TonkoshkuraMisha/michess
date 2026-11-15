# --- FILE: src/services/moderation.py ---
"""
Модерация (таск 17.4).

* Жалоба: на игрока (причина: нечестная игра, оскорбления, спам, другое) или на сообщение в чате (копия текста).
  Одна открытая жалоба от игрока на игрока; на себя — нельзя.
* Флаг нечестной игры по-прежнему ставит автоматика (src/services/anticheat.py), но теперь с заявкой в очередь на
  проверку (cheat_review); помеченный игрок может подать апелляцию (одну открытую).
* Решения модератора: dismiss — отклонить; warn — предупреждение; chat_ban — отключить чат на CHAT_BAN_HOURS;
  mark_cheater — подтвердить флаг; clear_cheater — снять флаг (и вернуть доверие). Автор жалобы или апелляции получает
  уведомление «ответ на жалобу» (центр уведомлений, 17.1).
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.moderation import Report
from src.models.user import User
from src.services import notifications

REASONS = ("cheating", "abuse", "spam", "other")
ACTIONS = ("dismiss", "warn", "chat_ban", "mark_cheater", "clear_cheater")
CHAT_BAN_HOURS = 24
RESTORED_TRUST = 100


def _now() -> datetime:
    return datetime.now(UTC)


def chat_banned(user: User, now: datetime | None = None) -> bool:
    until = user.chat_banned_until
    if until is None:
        return False
    until = until.replace(tzinfo=UTC) if until.tzinfo is None else until
    return until > (now or _now())


async def report(db: AsyncSession, reporter: User, target: User, kind: str, reason: str, comment: str | None,
                 message_text: str | None = None, game_id: int | None = None) -> Report:
    if kind not in ("player", "message") or reason not in REASONS:
        raise DomainError("report_invalid")
    if target.id == reporter.id:
        raise DomainError("report_self")
    exists = await db.scalar(select(Report.id).where(
        Report.reporter_id == reporter.id, Report.target_id == target.id, Report.status == "open"))
    if exists is not None:
        raise DomainError("report_duplicate")
    item = Report(kind=kind, reporter_id=reporter.id, target_id=target.id, reason=reason,
                  comment=" ".join((comment or "").split())[:300] or None,
                  message_text=(message_text or "")[:300] or None, game_id=game_id)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def flag_for_review(db: AsyncSession, user: User, game_id: int | None) -> None:
    """Автоматика пометила игрока — заявка на проверку (если открытой ещё нет). Без commit."""
    exists = await db.scalar(select(Report.id).where(
        Report.target_id == user.id, Report.kind == "cheat_review", Report.status == "open"))
    if exists is None:
        db.add(Report(kind="cheat_review", reporter_id=None, target_id=user.id, reason="auto", game_id=game_id))


async def appeal(db: AsyncSession, user: User, comment: str | None) -> Report:
    if not user.is_cheater:
        raise DomainError("appeal_not_flagged")
    exists = await db.scalar(select(Report.id).where(
        Report.target_id == user.id, Report.kind == "appeal", Report.status == "open"))
    if exists is not None:
        raise DomainError("report_duplicate")
    item = Report(kind="appeal", reporter_id=user.id, target_id=user.id, reason="other",
                  comment=" ".join((comment or "").split())[:300] or None)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def queue(db: AsyncSession) -> list[dict]:
    """Открытые заявки, старые первыми; у каждой — имена и сколько всего жалоб на этого игрока."""
    open_reports = select(Report).where(Report.status == "open").order_by(Report.created_at, Report.id)
    rows = (await db.execute(open_reports)).scalars().all()
    names = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_({r.target_id for r in rows} | {r.reporter_id for r in rows if r.reporter_id}))
    )).scalars()}
    counts: dict[int, int] = {target: count for target, count in (await db.execute(
        select(Report.target_id, func.count()).where(Report.kind.in_(("player", "message"))).group_by(Report.target_id)
    )).all()}
    result = []
    for r in rows:
        target = names.get(r.target_id)
        result.append({
            "id": r.id, "kind": r.kind, "reason": r.reason, "comment": r.comment, "message_text": r.message_text,
            "game_id": r.game_id, "created_at": r.created_at.isoformat() if r.created_at else None,
            "reporter": names[r.reporter_id].username if r.reporter_id in names else None,
            "target": target.username if target else None,
            "target_is_cheater": bool(target and target.is_cheater),
            "target_trust": target.trust_factor if target else None,
            "reports_on_target": counts.get(r.target_id, 0),
        })
    return result


async def resolve(db: AsyncSession, moderator: User, report_id: int, action: str) -> Report:
    if not moderator.is_moderator:
        raise DomainError("moderator_only")
    if action not in ACTIONS:
        raise DomainError("report_invalid")
    item = await db.get(Report, report_id)
    if item is None or item.status != "open":
        raise DomainError("report_not_found")
    target = await db.get(User, item.target_id)
    if target is not None:
        if action == "chat_ban":
            target.chat_banned_until = _now() + timedelta(hours=CHAT_BAN_HOURS)
        elif action == "mark_cheater":
            target.is_cheater = True
        elif action == "clear_cheater":
            target.is_cheater = False
            target.trust_factor = max(target.trust_factor, RESTORED_TRUST)
    item.status, item.action, item.moderator_id, item.resolved_at = "resolved", action, moderator.id, _now()
    # Остальные открытые заявки по тому же флагу закрываются этим же решением.
    if action in ("mark_cheater", "clear_cheater"):
        for other in (await db.execute(select(Report).where(
                Report.target_id == item.target_id, Report.kind.in_(("cheat_review", "appeal")),
                Report.status == "open", Report.id != item.id))).scalars():
            other.status, other.action, other.moderator_id, other.resolved_at = "resolved", action, moderator.id, _now()
    await db.commit()
    if item.reporter_id is not None:
        await notifications.push(db, item.reporter_id, "report_answer", {"report_id": item.id, "action": action})
    return item
