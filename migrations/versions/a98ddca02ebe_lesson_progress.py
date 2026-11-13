# --- FILE: migrations/versions/a98ddca02ebe_lesson_progress.py ---

"""lesson_progress

Школа (таск 14.1): прогресс уроков игрока — дальний шаг, завершение и лучший результат контрольных вопросов.
Сами уроки — данные клиента (frontend/src/content/lessons).

Revision ID: a98ddca02ebe
Revises: a2c4e6f8b0d1
Create Date: 2026-11-13 16:37:32.277420

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a98ddca02ebe"
down_revision: str | Sequence[str] | None = "a2c4e6f8b0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("lesson_progress",
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("user_id", sa.Integer(), nullable=False),
    sa.Column("lesson_id", sa.String(length=64), nullable=False),
    sa.Column("step", sa.Integer(), nullable=False),
    sa.Column("steps_total", sa.Integer(), nullable=False),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("exam_score", sa.Integer(), nullable=True),
    sa.Column("exam_total", sa.Integer(), nullable=True),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id"),
    sa.UniqueConstraint("user_id", "lesson_id", name="uq_lesson_progress_user_lesson")
    )
    op.create_index(op.f("ix_lesson_progress_user_id"), "lesson_progress", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_lesson_progress_user_id"), table_name="lesson_progress")
    op.drop_table("lesson_progress")
