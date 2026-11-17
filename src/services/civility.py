# --- FILE: src/services/civility.py ---
"""
Уважительное общение (таск 30.3): фильтр оскорблений до отправки, ограничения новичкам и нарушителям, придержание.

Фильтр: текст нормализуется (регистр, ё→е, «цифры вместо букв», латинские двойники в кириллическом слове, повторы
букв) и сверяется со словарём civility_lexicon.txt. Сработал — клиент получает text_flagged и предлагает переписать;
если игрок всё же отправляет (send_anyway), текст сохраняется придержанным (held): его видит только автор, а в
очередь модератора уходит заявка kind="held". Автоматика только помечает и придерживает — решает модератор
(release — выпустить, hide — убрать).

Ограничения: новичок (аккаунту меньше NEWCOMER_DAYS) и нарушитель (за последние VIOLATOR_DAYS модератор вынес по
жалобе на него warn, chat_ban или hide) отправляют не больше QUOTAS[scope] в час.
"""

import re
from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.moderation import Report
from src.models.social import DirectMessage, Post, PostComment
from src.models.user import User

LEXICON = Path(__file__).with_name("civility_lexicon.txt")
NEWCOMER_DAYS = 3
VIOLATOR_DAYS = 30
QUOTAS = {"dm": 20, "comment": 10, "post": 3}
PENALTIES = ("warn", "chat_ban", "hide")

_TOKEN = re.compile(r"[\w@$]+")


def _is_cyrillic(token: str) -> bool:
    return any(0x0400 <= ord(ch) <= 0x04FF for ch in token)


def _collapse(word: str) -> str:
    return re.sub(r"(.)\1+", r"\1", word)


@cache
def _source() -> tuple[dict[str, dict[int, str]], list[str]]:
    """Таблицы нормализации (строки «@имя a=b c=d») и записи словаря — из civility_lexicon.txt: буквы алфавита
    живут в данных, а не в коде сервера (правило: в исходниках src нет кириллических строк)."""
    tables: dict[str, dict[int, str]] = {}
    entries: list[str] = []
    for line in LEXICON.read_text(encoding="utf-8").splitlines():
        entry = line.strip()
        if not entry or entry.startswith("#"):
            continue
        if entry.startswith("@"):
            name, *pairs = entry[1:].split()
            tables[name] = str.maketrans({src: dst for src, _, dst in (pair.partition("=") for pair in pairs)})
        else:
            entries.append(entry)
    return tables, entries


def _norm_token(token: str) -> str:
    tables = _source()[0]
    token = token.lower().translate(tables.get("fold", {}))
    if _is_cyrillic(token):
        token = token.translate(tables.get("leet-cyr", {})).translate(tables.get("lookalike", {}))
    else:
        token = token.translate(tables.get("leet", {}))
    return _collapse(token.replace("_", ""))


def normalize(text: str) -> list[str]:
    return [t for t in (_norm_token(raw) for raw in _TOKEN.findall(text or "")) if t]


@cache
def _lexicon() -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    prefixes: list[str] = []
    exact: list[str] = []
    roots: list[str] = []
    phrases: list[str] = []
    for entry in _source()[1]:
        mark = entry[0] if entry[0] in "=*" else ""
        words = normalize(entry.lstrip("=*"))
        if len(words) > 1:
            phrases.append(" ".join(words))
        elif words:
            {"=": exact, "*": roots, "": prefixes}[mark].append(words[0])
    return tuple(prefixes), tuple(exact), tuple(roots), tuple(phrases)

def offensive(text: str | None) -> bool:
    """
    Есть ли в тексте оскорбление: слова после нормализации сверяются со словарём — точные слова, начала слов, корни и
    фразы.
    """
    tokens = normalize(text or "")
    if not tokens:
        return False
    prefixes, exact, roots, phrases = _lexicon()
    for token in tokens:
        if token in exact or token.startswith(prefixes) or any(root in token for root in roots):
            return True
    joined = f" {' '.join(tokens)} "
    return any(f" {phrase} " in joined for phrase in phrases)


def screen(text: str | None, send_anyway: bool) -> bool:
    """True — придержать. Без send_anyway оскорбительный текст не принимается: предложить переписать."""
    if not offensive(text):
        return False
    if not send_anyway:
        raise DomainError("text_flagged")
    return True


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def restricted(db: AsyncSession, user: User) -> bool:
    """
    Действуют ли для игрока квоты: аккаунт моложе NEWCOMER_DAYS или за последние VIOLATOR_DAYS модератор вынес по
    жалобе на него взыскание.
    """
    now = datetime.now(UTC)
    created = _aware(user.created_at)
    if created is not None and created > now - timedelta(days=NEWCOMER_DAYS):
        return True
    penalty = await db.scalar(select(Report.id).where(
        Report.target_id == user.id, Report.status == "resolved", Report.action.in_(PENALTIES),
        Report.resolved_at > now - timedelta(days=VIOLATOR_DAYS)).limit(1))
    return penalty is not None


_SCOPES = {"dm": (DirectMessage.sender_id, DirectMessage.created_at), "post": (Post.author_id, Post.created_at),
           "comment": (PostComment.author_id, PostComment.created_at)}


async def check_quota(db: AsyncSession, user: User, scope: str) -> None:
    if not await restricted(db, user):
        return
    author, created = _SCOPES[scope]
    since = datetime.now(UTC) - timedelta(hours=1)
    sent = await db.scalar(select(func.count()).where(author == user.id, created > since)) or 0
    if sent >= QUOTAS[scope]:
        raise DomainError("posting_limited", limit=QUOTAS[scope])


async def hold(db: AsyncSession, author_id: int, subject: str, text: str) -> None:
    """Заявка модератору на придержанный текст (коммит — у вызывающего)."""
    db.add(Report(kind="held", reporter_id=None, target_id=author_id, reason="auto", subject=subject,
                  message_text=(text or "")[:300] or None))
