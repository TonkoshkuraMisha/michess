# --- FILE: migrations/versions/c5e7a9b1d3f6_theme_training.py ---

"""theme_training

Тренировка по приёмам (таск 13.4): ступень задачи (1 — знакомство … 4 — мастер) и прогресс игрока по каждой теме.
Ступень уже загруженных задач считается здесь же — по рейтингу и длине решения (как в src/services/puzzles.py).

Revision ID: c5e7a9b1d3f6
Revises: b3d5f7a9c1e4
Create Date: 2026-11-14 06:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c5e7a9b1d3f6"
down_revision: str | Sequence[str] | None = "b3d5f7a9c1e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Число ходов решающего = (число ходов в строке − 1) / 2; пробелов в строке на один меньше, чем ходов.
_PLIES = "(length(moves) - length(replace(moves, ' ', '')) + 1)"


def upgrade() -> None:
    op.add_column("puzzles", sa.Column("stage", sa.Integer(), nullable=False, server_default="1"))
    op.execute(f"""
        UPDATE puzzles SET stage = CASE
            WHEN rating >= 2000 OR {_PLIES} >= 10 THEN 4
            WHEN rating >= 1600 OR {_PLIES} >= 8 THEN 3
            WHEN rating >= 1200 OR {_PLIES} >= 6 THEN 2
            ELSE 1 END
    """)
    op.create_index("ix_puzzles_stage", "puzzles", ["stage"])
    # Версия разметки тем: импорт переразмечает задачи с версией ниже текущей (новые темы, классификатор матов).
    op.add_column("puzzles", sa.Column("tag_version", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "theme_progress",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("theme", sa.String(40), primary_key=True),
        sa.Column("stage", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("recent", sa.String(10), nullable=False, server_default=""),
        sa.Column("solved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mastered", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("theme_progress")
    op.drop_column("puzzles", "tag_version")
    op.drop_index("ix_puzzles_stage", table_name="puzzles")
    op.drop_column("puzzles", "stage")
