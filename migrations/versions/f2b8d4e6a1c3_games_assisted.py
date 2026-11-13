# --- FILE: migrations/versions/f2b8d4e6a1c3_games_assisted.py ---

"""games_assisted

Игра с наставником (таск 11.3): партия, в которой игрок пользовался советами или проверкой ходов, помечается
учебной (правило 2 Части II).

Revision ID: f2b8d4e6a1c3
Revises: e1a7c3d9b5f2
Create Date: 2026-11-13 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2b8d4e6a1c3"
down_revision: str | Sequence[str] | None = "e1a7c3d9b5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("games", sa.Column("assisted", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column("games", "assisted")
