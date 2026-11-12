# --- FILE: migrations/versions/a4d2e8f1c6b9_normalize_stored_pgn.py ---

"""normalize_stored_pgn

Архив партий чемпионов, импортированный на Windows, хранил PGN с пустой строкой после каждой
строки: файл архива записывался в текстовом режиме поверх уже виндовых переводов строк (\\r\\r\\n).
По стандарту PGN пустая строка завершает партию, поэтому сервер видел партию из одного заголовка
без ходов, и разбор движком «успешно» возвращал пустой анализ с точностью 100 %.

Миграция приводит такие PGN к каноническому виду (заголовки подряд, одна пустая строка, ходы),
тем же алгоритмом, что src.services.game_engine.normalize_pgn_text (скопирован сюда, чтобы
миграция не зависела от будущих правок кода). Пустые анализы пересчитаются сами: кэш анализа
сверяет число ходов с PGN. Даунгрейд ничего не делает — портить данные обратно незачем.

Revision ID: a4d2e8f1c6b9
Revises: c3f8a2e1d9b7
Create Date: 2026-11-12 20:00:00.000000

"""
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d2e8f1c6b9"
down_revision: str | Sequence[str] | None = "c3f8a2e1d9b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BATCH = 2000
_LINE_BREAK_RE = re.compile(r"\r+\n|\r")


def _normalize(pgn_text: str) -> str:
    lines = [line.strip() for line in _LINE_BREAK_RE.sub("\n", pgn_text.lstrip("﻿")).split("\n")]
    headers: list[str] = []
    i = 0
    while i < len(lines) and (not lines[i] or lines[i].startswith("[")):
        if lines[i]:
            headers.append(lines[i])
        i += 1
    movetext = "\n".join(line for line in lines[i:] if line)
    if not headers:
        return movetext
    return "\n".join(headers) + "\n\n" + movetext + "\n"


def upgrade() -> None:
    bind = op.get_bind()
    games = sa.table("games", sa.column("id", sa.Integer), sa.column("pgn", sa.Text))
    last_id = 0
    while True:
        rows = bind.execute(
            sa.select(games.c.id, games.c.pgn)
            .where(games.c.id > last_id, games.c.pgn.is_not(None))
            .order_by(games.c.id)
            .limit(BATCH)
        ).all()
        if not rows:
            break
        last_id = rows[-1].id
        # Целые PGN (блок заголовков + блок ходов) не трогаем — только испорченные.
        updates = [
            {"row_id": row.id, "new_pgn": _normalize(row.pgn)}
            for row in rows
            if _has_blank_line_inside(row.pgn)
        ]
        if updates:
            bind.execute(
                games.update().where(games.c.id == sa.bindparam("row_id")).values(pgn=sa.bindparam("new_pgn")),
                updates,
            )


def _has_blank_line_inside(pgn_text: str) -> bool:
    """Лишняя пустая строка внутри заголовков или ходов — признак испорченного PGN."""
    blocks = [b for b in re.split(r"\n\s*\n", _LINE_BREAK_RE.sub("\n", pgn_text).strip()) if b.strip()]
    return len(blocks) > 2


def downgrade() -> None:
    pass
