# --- FILE: migrations/versions/d7f9b1c3e5a8_personal_puzzles.py ---

"""personal_puzzles

Задачи из партий игрока (таск 13.5) с повторением через интервалы.

Revision ID: d7f9b1c3e5a8
Revises: c5e7a9b1d3f6
Create Date: 2026-11-14 08:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7f9b1c3e5a8"
down_revision: str | Sequence[str] | None = "c5e7a9b1d3f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "personal_puzzles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("game_id", sa.Integer(), sa.ForeignKey("games.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ply", sa.Integer(), nullable=False),
        sa.Column("fen", sa.String(100), nullable=False),
        sa.Column("previous_move", sa.String(5), nullable=True),
        sa.Column("solution", sa.String(5), nullable=False),
        sa.Column("played", sa.String(5), nullable=False),
        sa.Column("cp_loss", sa.Integer(), nullable=False),
        sa.Column("themes", sa.String(300), nullable=False, server_default=""),
        sa.Column("interval_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("solved_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("due_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "game_id", "ply", name="uq_personal_puzzles_move"),
    )
    op.create_index("ix_personal_puzzles_user_id", "personal_puzzles", ["user_id"])
    op.create_index("ix_personal_puzzles_game_id", "personal_puzzles", ["game_id"])
    op.create_index("ix_personal_puzzles_due_at", "personal_puzzles", ["due_at"])


def downgrade() -> None:
    op.drop_index("ix_personal_puzzles_due_at", table_name="personal_puzzles")
    op.drop_index("ix_personal_puzzles_game_id", table_name="personal_puzzles")
    op.drop_index("ix_personal_puzzles_user_id", table_name="personal_puzzles")
    op.drop_table("personal_puzzles")
