# --- FILE: migrations/versions/b3d5f7a9c1e4_puzzle_timed_records.py ---

"""puzzle_timed_records

Личные рекорды режима задач на время (таск 13.3): решено задач за 3 и за 5 минут.

Revision ID: b3d5f7a9c1e4
Revises: a7c9e1f3b5d2
Create Date: 2026-11-14 04:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d5f7a9c1e4"
down_revision: str | Sequence[str] | None = "a7c9e1f3b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("puzzle_best_3", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("puzzle_best_5", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "puzzle_best_5")
    op.drop_column("users", "puzzle_best_3")
