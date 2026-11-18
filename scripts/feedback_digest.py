# --- FILE: scripts/feedback_digest.py ---
"""
Еженедельный разбор отзывов беты (таск 24.4): сводка сообщений «Сообщить о проблеме» в готовом для ToDo.md виде.

    python scripts/feedback_digest.py                       # последние 7 дней, в консоль
    python scripts/feedback_digest.py --days 14
    python scripts/feedback_digest.py --until 2026-11-16    # неделя до этой даты (не включая её)
    python scripts/feedback_digest.py --output digest.md    # в файл (UTF-8)

Блок вставляется в ToDo.md как есть: неразобранные сообщения — пунктами «- [ ]», из которых получаются правки плана;
закрытые за период — «- [x]». Статусы сообщений меняет модератор на странице /moderation.
"""

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.services.beta import OPEN_STATUSES, Digest, DigestItem  # noqa: E402

STATUS_NAMES = {"new": "новых", "in_progress": "в работе", "done": "сделано", "rejected": "отклонено"}
MESSAGE_WIDTH = 240


def _line(item: DigestItem) -> str:
    """Форматирует одну запись обратной связи в строку списка Markdown."""
    text = " / ".join(part.strip() for part in item.message.splitlines() if part.strip())
    if len(text) > MESSAGE_WIDTH:
        text = text[:MESSAGE_WIDTH - 1].rstrip() + "…"
    details = [item.author or "гость", item.language, item.screen, f"v{item.app_version}" if item.app_version else None]
    meta = ", ".join(part for part in details if part)
    if item.status == "in_progress":
        meta += "; в работе"
    elif item.status == "rejected":
        meta += "; отклонено"
    mark = " " if item.status in OPEN_STATUSES else "x"
    page = f" `{item.page}`" if item.page else ""
    return f"- [{mark}] #{item.id}{page} — {text} ({meta})"


def render(digest: Digest) -> str:
    """Собирает текстовую сводку отзывов беты по статусам и разделам."""
    last_day = (digest.until - timedelta(microseconds=1)).date()
    lines = [f"### Отзывы беты: {digest.since.date():%d.%m} – {last_day:%d.%m.%Y}", ""]
    if digest.items:
        counts = ", ".join(f"{name} {digest.by_status.get(status, 0)}" for status, name in STATUS_NAMES.items())
        lines.append(f"* Пришло {len(digest.items)}: {counts}. Неразобранных всего: {digest.backlog}.")
        pages = ", ".join(f"{'без страницы' if page == '?' else f'`{page}`'} — {count}" for page, count in digest.by_page)
        lines.append(f"* По разделам: {pages}.")
    else:
        lines.append(f"* Сообщений за неделю не было. Неразобранных всего: {digest.backlog}.")
    lines.append(f"* Приглашения: по кодам пришло {digest.invited}, действующих кодов {digest.active_invites}.")
    for title, wanted in (("К разбору:", True), ("Закрыто за период:", False)):
        chosen = [item for item in digest.items if (item.status in OPEN_STATUSES) is wanted]
        if chosen:
            lines += ["", title, *(_line(item) for item in chosen)]
    return "\n".join(lines) + "\n"


async def main(days: int, until: datetime) -> str:
    """Выгружает отзывы из БД и печатает дайджест для плана работ."""
    from src.db.session import AsyncSessionLocal
    from src.services.beta import build_digest

    async with AsyncSessionLocal() as db:
        return render(await build_digest(db, until - timedelta(days=days), until))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7, help="Длина периода в днях")
    parser.add_argument("--until", type=lambda value: datetime.fromisoformat(value).replace(tzinfo=UTC), default=None,
                        help="Конец периода (ГГГГ-ММ-ДД, не включая этот день); по умолчанию — сейчас")
    parser.add_argument("--output", type=Path, default=None, help="Записать в файл вместо консоли")
    args = parser.parse_args()
    digest_text = asyncio.run(main(args.days, args.until or datetime.now(UTC)))
    if args.output is None:
        print(digest_text, end="")
    else:
        args.output.write_text(digest_text, encoding="utf-8", newline="\n")
        print(f"Сводка записана в {args.output}")
