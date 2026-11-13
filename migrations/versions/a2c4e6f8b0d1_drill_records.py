# --- FILE: migrations/versions/a2c4e6f8b0d1_drill_records.py ---

"""drill_records

Личные рекорды забега на минуту в упражнениях-генераторах (таск 13.7).

Revision ID: a2c4e6f8b0d1
Revises: f3b5d7e9a1c2
Create Date: 2026-11-13 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a2c4e6f8b0d1"
down_revision: str | Sequence[str] | None = "f3b5d7e9a1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "drill_records",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("combo", sa.String(30), primary_key=True),
        sa.Column("best", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("drill_records")
