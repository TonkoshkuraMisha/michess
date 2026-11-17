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
* Таск 30.3: жалоба на конкретный текст — личное сообщение, публикацию, комментарий (kind="content", subject
  «dm:id» / «post:id» / «comment:id», копия текста) в один шаг; придержанное фильтром — заявка kind="held".
  Решения по тексту: hide — убрать (публикацию скрыть, сообщение и комментарий удалить), release — выпустить
  придержанное; warn и chat_ban по тексту тоже убирают его. Все открытые заявки на тот же текст закрываются вместе.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.moderation import Report
from src.models.social import DirectMessage, Post, PostComment
from src.models.user import User
from src.services import notifications

REASONS = ("cheating", "abuse", "spam", "other")
ACTIONS = ("dismiss", "warn", "chat_ban", "mark_cheater", "clear_cheater", "accept", "hide", "release")
TEXT_KINDS = ("content", "held")
SUBJECT_KINDS = ("dm", "post", "comment")
LANGUAGES = ("en", "uk", "ru")
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


async def suggest_translation(db: AsyncSession, user: User, language: str, key: str, current: str | None,
                             suggestion: str, context: str | None) -> Report:
    """Предложение исправить текст интерфейса (таск 17.7): только в режиме «помощник перевода»."""
    suggestion = " ".join(suggestion.split())[:300]
    if not user.translation_helper:
        raise DomainError("translation_helper_off")
    if language not in LANGUAGES or not key or not suggestion:
        raise DomainError("report_invalid")
    subject = f"{language}:{key}"[:200]
    exists = await db.scalar(select(Report.id).where(
        Report.reporter_id == user.id, Report.kind == "translation", Report.subject == subject, Report.status == "open"))
    if exists is not None:
        raise DomainError("report_duplicate")
    item = Report(kind="translation", reporter_id=user.id, target_id=user.id, reason="other", subject=subject,
                  context=(context or "")[:200] or None, message_text=(current or "")[:300] or None, comment=suggestion)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


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
        select(Report.target_id, func.count()).where(Report.kind.in_(("player", "message", *TEXT_KINDS)))
        .group_by(Report.target_id)
    )).all()}
    result = []
    for r in rows:
        target = names.get(r.target_id)
        result.append({
            "id": r.id, "kind": r.kind, "reason": r.reason, "comment": r.comment, "message_text": r.message_text,
            "subject": r.subject, "context": r.context,
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
    if item.kind in TEXT_KINDS and item.subject:
        await _apply_to_text(db, item.subject, action)
        for other in (await db.execute(select(Report).where(
                Report.subject == item.subject, Report.kind.in_(TEXT_KINDS), Report.status == "open",
                Report.id != item.id))).scalars():
            other.status, other.action, other.moderator_id, other.resolved_at = "resolved", action, moderator.id, _now()
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

def _parse_subject(subject: str) -> tuple[str, int]:
    kind, _, raw = (subject or "").partition(":")
    if kind not in SUBJECT_KINDS or not raw.isdigit():
        raise DomainError("report_invalid")
    return kind, int(raw)


async def load_text(db: AsyncSession, subject: str) -> DirectMessage | Post | PostComment:
    kind, key = _parse_subject(subject)
    item: DirectMessage | Post | PostComment | None
    if kind == "dm":
        item = await db.get(DirectMessage, key)
    elif kind == "post":
        item = await db.get(Post, key)
    else:
        item = await db.get(PostComment, key)
    if item is None:
        raise DomainError("report_not_found")
    return item


def _author(item: DirectMessage | Post | PostComment) -> int:
    return item.sender_id if isinstance(item, DirectMessage) else item.author_id


async def _can_see(db: AsyncSession, item: DirectMessage | Post | PostComment, user: User) -> bool:
    if isinstance(item, DirectMessage):
        return item.recipient_id == user.id and not item.held
    if isinstance(item, Post):
        return item.hidden_at is None and not item.held
    post = await db.get(Post, item.post_id)
    return not item.held and post is not None and post.hidden_at is None and not post.held


async def report_text(db: AsyncSession, reporter: User, subject: str, reason: str) -> Report:
    """Жалоба на сообщение, публикацию или комментарий в один шаг: текст копируется в заявку."""
    if reason not in REASONS:
        raise DomainError("report_invalid")
    item = await load_text(db, subject)
    author_id = _author(item)
    if author_id == reporter.id:
        raise DomainError("report_self")
    if not await _can_see(db, item, reporter):
        raise DomainError("report_not_found")
    kind, key = _parse_subject(subject)
    normalized = f"{kind}:{key}"
    exists = await db.scalar(select(Report.id).where(
        Report.reporter_id == reporter.id, Report.subject == normalized, Report.status == "open"))
    if exists is not None:
        raise DomainError("report_duplicate")
    report = Report(kind="content", reporter_id=reporter.id, target_id=author_id, reason=reason, subject=normalized,
                    message_text=(item.body or "")[:300] or None)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def _apply_to_text(db: AsyncSession, subject: str, action: str) -> None:
    try:
        item = await load_text(db, subject)
    except DomainError:
        return  # текст уже удалён автором — решение касается только игрока
    if action == "release":
        item.held = False
    elif action in ("hide", "warn", "chat_ban"):
        if isinstance(item, Post):
            item.hidden_at = _now()
            item.held = False
        else:
            await db.delete(item)
