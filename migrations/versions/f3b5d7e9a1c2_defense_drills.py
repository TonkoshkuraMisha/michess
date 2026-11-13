# --- FILE: migrations/versions/f3b5d7e9a1c2_defense_drills.py ---

"""defense_drills

Защитные упражнения (таск 13.6): «Что грозит соперник?» и «Не зевни». Загружаются из
data/puzzles/defense_drills.csv.gz (scripts/import_puzzles.py).

Revision ID: f3b5d7e9a1c2
Revises: e9a1c3d5f7b9
Create Date: 2026-11-13 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b5d7e9a1c2"
down_revision: str | Sequence[str] | None = "e9a1c3d5f7b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "defense_drills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_id", sa.String(20), nullable=False),
        sa.Column("fen", sa.String(100), nullable=False),
        sa.Column("threat", sa.String(5), nullable=True),
        sa.Column("choices", sa.String(20), nullable=False, server_default=""),
        sa.Column("refutations", sa.String(30), nullable=False, server_default=""),
        sa.Column("good_moves", sa.String(30), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("stage", sa.Integer(), nullable=False),
        sa.Column("motifs", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("kind", "source", "source_id", name="uq_defense_drills_source"),
    )
    op.create_index("ix_defense_drills_kind_stage", "defense_drills", ["kind", "stage"])


def downgrade() -> None:
    op.drop_index("ix_defense_drills_kind_stage", table_name="defense_drills")
    op.drop_table("defense_drills")
