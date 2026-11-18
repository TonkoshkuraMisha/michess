# --- FILE: src/services/beta.py ---
"""
Программа беты (таск 24.4).

* Приглашения. Код создаёт модератор: с лимитом использований и сроком действия (оба необязательны), отзыв —
  в любой момент. Код принимается, пока он не отозван, не истёк и не исчерпан. Списание — одним UPDATE с условием,
  в той же транзакции, что и создание аккаунта: два одновременных запроса не превысят лимит, а несостоявшаяся
  регистрация код не тратит.
* «Сообщить о проблеме». Текст игрока (или гостя) с контекстом: страница, версия приложения, язык, размер экрана.
  Очередь модератора со статусами new → in_progress → done | rejected.
* Сводка за период (scripts/feedback_digest.py): сколько пришло, как разобрано, на каких страницах, список.
"""

import secrets
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.errors import DomainError
from src.models.beta import Feedback, Invite
from src.models.user import User

# Без похожих знаков (0/O, 1/I/L): код диктуют и переписывают вручную.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
# Длина создаваемого кода и наибольшая длина кода, принимаемая на входе (лишнее отбрасывается в normalize_code).
CODE_LENGTH = 10
MAX_CODE_LENGTH = 32
# Верхние границы лимита использований и срока действия кода; их проверяет схема запроса в src/api/beta.py.
MAX_USES = 100_000
MAX_EXPIRES_DAYS = 365

# Статусы сообщения о проблеме; OPEN_STATUSES — неразобранные (очередь модератора по умолчанию и остаток в сводке).
FEEDBACK_STATUSES = ("new", "in_progress", "done", "rejected")
OPEN_STATUSES = ("new", "in_progress")
# Длина текста сообщения в знаках: длиннее — обрезается, короче — отказ feedback_invalid.
MESSAGE_MAX = 2000
MESSAGE_MIN = 5
# Сколько сообщений отдаёт очередь модератора за один запрос.
FEEDBACK_PAGE_SIZE = 100
# Языки интерфейса; другое значение языка в сообщении не сохраняется.
LANGUAGES = ("en", "uk", "ru")


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value is not None else None


def _moderator(user: User) -> None:
    if not user.is_moderator:
        raise DomainError("moderator_only")


def community_url() -> str | None:
    """Ссылка на канал сообщества из настроек сервера; что-либо, кроме адреса http(s), ссылкой не считается."""
    url = settings.COMMUNITY_URL.strip()
    return url if url.startswith(("https://", "http://")) else None


# --- приглашения ---------------------------------------------------------------------------------------------------

def normalize_code(raw: str | None) -> str:
    """Код в том виде, в каком он хранится: без пробелов, в верхнем регистре, не длиннее MAX_CODE_LENGTH знаков."""
    return "".join((raw or "").split()).upper()[:MAX_CODE_LENGTH]


def invite_state(invite: Invite, now: datetime | None = None) -> str:
    """active | revoked | expired | used_up; при нескольких причинах сразу — первая из них в этом порядке проверки."""
    now = now or _now()
    if invite.revoked_at is not None:
        return "revoked"
    expires = _aware(invite.expires_at)
    if expires is not None and expires <= now:
        return "expired"
    if invite.max_uses is not None and invite.uses >= invite.max_uses:
        return "used_up"
    return "active"


def _invite_view(invite: Invite, now: datetime) -> dict:
    return {
        "id": invite.id, "code": invite.code, "note": invite.note, "max_uses": invite.max_uses, "uses": invite.uses,
        "expires_at": _iso(invite.expires_at), "revoked_at": _iso(invite.revoked_at),
        "created_at": _iso(invite.created_at), "state": invite_state(invite, now),
    }


async def create_invite(db: AsyncSession, moderator: User, note: str | None, max_uses: int | None,
                        expires_in_days: int | None) -> dict:
    """
    Новый код: CODE_LENGTH случайных знаков из CODE_ALPHABET. Границы max_uses и expires_in_days проверяет схема
    запроса (src/api/beta.py); пустое значение — без лимита или без срока. Пометка note — до 100 знаков.
    """
    _moderator(moderator)
    now = _now()
    invite = Invite(
        code="".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH)),
        note=" ".join((note or "").split())[:100] or None, max_uses=max_uses,
        expires_at=now + timedelta(days=expires_in_days) if expires_in_days else None, created_by=moderator.id,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return _invite_view(invite, now)


async def list_invites(db: AsyncSession, moderator: User) -> list[dict]:
    """Все приглашения, новые первыми: сколько человек пришло по каждому и действует ли оно."""
    _moderator(moderator)
    now = _now()
    rows = (await db.execute(select(Invite).order_by(Invite.created_at.desc(), Invite.id.desc()))).scalars().all()
    return [_invite_view(invite, now) for invite in rows]


async def revoke_invite(db: AsyncSession, moderator: User, invite_id: int) -> dict:
    """Отзыв кода-приглашения модератором: код перестаёт приниматься. Повторный отзыв ничего не меняет."""
    _moderator(moderator)
    invite = await db.get(Invite, invite_id)
    if invite is None:
        raise DomainError("beta_invite_not_found")
    now = _now()
    if invite.revoked_at is None:
        invite.revoked_at = now
        await db.commit()
    return _invite_view(invite, now)


def _usable(now: datetime) -> tuple:
    """Условия SQL «код действует»: не отозван, не истёк, не исчерпан — то же, что invite_state == "active"."""
    return (
        Invite.revoked_at.is_(None),
        or_(Invite.expires_at.is_(None), Invite.expires_at > now),
        or_(Invite.max_uses.is_(None), Invite.uses < Invite.max_uses),
    )


async def invite_usable(db: AsyncSession, code: str | None) -> bool:
    """Примет ли регистрация этот код прямо сейчас (для подсказки в форме; списание — consume_invite)."""
    code = normalize_code(code)
    if not code:
        return False
    return await db.scalar(select(Invite.id).where(Invite.code == code, *_usable(_now()))) is not None


async def consume_invite(db: AsyncSession, code: str | None) -> bool:
    """
    Одно использование кода: True — списано. Без commit: вызывающий фиксирует вместе с созданием аккаунта, а при
    откате списание отменяется.
    """
    code = normalize_code(code)
    if not code:
        return False
    used = await db.execute(
        update(Invite).where(Invite.code == code, *_usable(_now())).values(uses=Invite.uses + 1).returning(Invite.id)
    )
    return used.scalar_one_or_none() is not None


# --- сообщения о проблемах -----------------------------------------------------------------------------------------

def _clip(value: str | None, limit: int) -> str | None:
    return " ".join((value or "").split())[:limit] or None


async def submit_feedback(db: AsyncSession, user_id: int | None, message: str, page: str | None,
                          language: str | None, screen: str | None) -> Feedback:
    """
    Сообщение «Сообщить о проблеме»: текст короче MESSAGE_MIN — отказ, длиннее MESSAGE_MAX — обрезается; к тексту
    прикладываются страница, версия приложения, язык и размер экрана. user_id пуст — сообщение от гостя. Версию
    приложения сервер берёт из своих настроек (settings.VERSION), а не от клиента.
    """
    # Переводы строк в тексте сохраняются (шаги воспроизведения), лишние пробелы по краям — нет.
    text = "\n".join(line.rstrip() for line in message.strip().splitlines())[:MESSAGE_MAX]
    if len(text) < MESSAGE_MIN:
        raise DomainError("feedback_invalid")
    item = Feedback(
        user_id=user_id, message=text, page=_clip(page, 200), app_version=settings.VERSION[:20],
        language=language if language in LANGUAGES else None, screen=_clip(screen, 20),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


def _feedback_view(item: Feedback, username: str | None) -> dict:
    return {
        "id": item.id, "message": item.message, "page": item.page, "app_version": item.app_version,
        "language": item.language, "screen": item.screen, "status": item.status, "author": username,
        "created_at": _iso(item.created_at), "updated_at": _iso(item.updated_at),
    }


async def feedback_queue(db: AsyncSession, moderator: User, status: str | None = None) -> dict:
    """
    Сообщения для модератора: без status — неразобранные (new и in_progress), старые первыми; со status — только
    он, новые первыми. Не больше FEEDBACK_PAGE_SIZE сообщений. counts — сколько всего сообщений в каждом статусе.
    """
    _moderator(moderator)
    if status is not None and status not in FEEDBACK_STATUSES:
        raise DomainError("feedback_invalid")
    query = select(Feedback, User.username).outerjoin(User, Feedback.user_id == User.id)
    if status is None:
        query = query.where(Feedback.status.in_(OPEN_STATUSES)).order_by(Feedback.created_at, Feedback.id)
    else:
        query = query.where(Feedback.status == status).order_by(Feedback.created_at.desc(), Feedback.id.desc())
    rows = (await db.execute(query.limit(FEEDBACK_PAGE_SIZE))).all()
    found = dict((await db.execute(select(Feedback.status, func.count()).group_by(Feedback.status))).tuples().all())
    return {
        "items": [_feedback_view(item, username) for item, username in rows],
        "counts": {name: int(found.get(name, 0)) for name in FEEDBACK_STATUSES},
    }


async def set_feedback_status(db: AsyncSession, moderator: User, feedback_id: int, status: str) -> Feedback:
    """
    Статус сообщения о проблеме меняет модератор (значения — FEEDBACK_STATUSES); запоминается, кто и когда его
    поставил.
    """
    _moderator(moderator)
    if status not in FEEDBACK_STATUSES:
        raise DomainError("feedback_invalid")
    item = await db.get(Feedback, feedback_id)
    if item is None:
        raise DomainError("feedback_not_found")
    item.status, item.moderator_id, item.updated_at = status, moderator.id, _now()
    await db.commit()
    return item


# --- сводка за период ----------------------------------------------------------------------------------------------

@dataclass
class DigestItem:
    """Одно сообщение в сводке отзывов."""
    id: int
    created_at: datetime
    status: str
    author: str | None
    message: str
    page: str | None
    app_version: str | None
    language: str | None
    screen: str | None


@dataclass
class Digest:
    """
    Сводка отзывов за период: сообщения, счёт по статусам и по разделам сайта, остаток неразобранных и сведения о
    приглашениях.
    """
    since: datetime
    until: datetime
    items: list[DigestItem] = field(default_factory=list)
    by_status: dict[str, int] = field(default_factory=dict)
    by_page: list[tuple[str, int]] = field(default_factory=list)
    # Всего неразобранных на конец периода (включая пришедшие раньше).
    backlog: int = 0
    # Приглашения: сколько человек зарегистрировалось по кодам за всё время (сумма invites.uses) и сколько кодов
    # действует на момент сборки сводки.
    invited: int = 0
    active_invites: int = 0


def page_section(page: str | None) -> str:
    """Раздел сайта по пути страницы: «/puzzles/123?x=1» → «/puzzles»."""
    path = (page or "").split("?")[0].split("#")[0].strip()
    if not path.startswith("/"):
        return "?"
    head = path.split("/")[1]
    return f"/{head}" if head else "/"


async def build_digest(db: AsyncSession, since: datetime, until: datetime) -> Digest:
    """Собирает сводку отзывов за период [since, until) — для scripts/feedback_digest.py."""
    rows = (await db.execute(
        select(Feedback, User.username).outerjoin(User, Feedback.user_id == User.id)
        .where(Feedback.created_at >= since, Feedback.created_at < until).order_by(Feedback.created_at, Feedback.id)
    )).all()
    digest = Digest(since=since, until=until)
    for item, username in rows:
        created = _aware(item.created_at) or since
        digest.items.append(DigestItem(item.id, created, item.status, username, item.message, item.page,
                                       item.app_version, item.language, item.screen))
    digest.by_status = {name: sum(1 for item in digest.items if item.status == name) for name in FEEDBACK_STATUSES}
    # Чаще упомянутые разделы — первыми; сообщения без страницы («?») — в конце своей группы.
    pages = Counter(page_section(item.page) for item in digest.items)
    digest.by_page = sorted(pages.items(), key=lambda pair: (-pair[1], pair[0] == "?", pair[0]))
    digest.backlog = int(await db.scalar(
        select(func.count(Feedback.id)).where(Feedback.status.in_(OPEN_STATUSES), Feedback.created_at < until)) or 0)
    now = _now()
    invites = (await db.execute(select(Invite))).scalars().all()
    digest.invited = sum(invite.uses for invite in invites)
    digest.active_invites = sum(1 for invite in invites if invite_state(invite, now) == "active")
    return digest
