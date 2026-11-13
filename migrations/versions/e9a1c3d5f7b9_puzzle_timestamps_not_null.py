# --- FILE: migrations/versions/e9a1c3d5f7b9_puzzle_timestamps_not_null.py ---

"""puzzle_timestamps_not_null

Колонки времени в таблицах задач созданы миграциями a7c9e1f3b5d2, c5e7a9b1d3f6 и d7f9b1c3e5a8
без NOT NULL, а в моделях они обязательные — alembic check в CI находил расхождение.
Исходные миграции не правим: на уже развёрнутых базах они применены, и расхождение там
осталось бы. Пустые значения (их не должно быть — у колонок server_default now()) сначала
заполняются текущим временем.

Revision ID: e9a1c3d5f7b9
Revises: d7f9b1c3e5a8
Create Date: 2026-11-13 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9a1c3d5f7b9"
down_revision: str | Sequence[str] | None = "d7f9b1c3e5a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS: tuple[tuple[str, str], ...] = (
    ("puzzles", "created_at"),
    ("puzzle_attempts", "created_at"),
    ("theme_progress", "updated_at"),
    ("personal_puzzles", "due_at"),
    ("personal_puzzles", "created_at"),
)


def upgrade() -> None:
    for table, column in COLUMNS:
        op.execute(sa.text(f"UPDATE {table} SET {column} = now() WHERE {column} IS NULL"))
        op.alter_column(
            table, column,
            existing_type=sa.DateTime(timezone=True),
            existing_server_default=sa.text("now()"),
            nullable=False,
        )


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        op.alter_column(
            table, column,
            existing_type=sa.DateTime(timezone=True),
            existing_server_default=sa.text("now()"),
            nullable=True,
        )
