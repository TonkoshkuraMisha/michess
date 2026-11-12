# --- FILE: migrations/versions/c8e1f4a7b2d5_club_ladder.py ---

"""club_ladder

Клубная лестница (таск 10.4): отдельный рейтинг игрока в партиях с ботами без подсказок движка и
возвратов хода, число таких партий и ступень лестницы — индекс следующего соперника.

Revision ID: c8e1f4a7b2d5
Revises: bd6c0a20889e
Create Date: 2026-11-12 21:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8e1f4a7b2d5"
down_revision: str | Sequence[str] | None = "bd6c0a20889e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ladder_rating", sa.Integer(), server_default="1000", nullable=False))
    op.add_column("users", sa.Column("ladder_games", sa.Integer(), server_default="0", nullable=False))
    op.add_column("users", sa.Column("ladder_step", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("users", "ladder_step")
    op.drop_column("users", "ladder_games")
    op.drop_column("users", "ladder_rating")
