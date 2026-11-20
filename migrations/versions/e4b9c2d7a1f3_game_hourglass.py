"""game hourglass

Партия с «песочными часами» (фора, таск 21.1): флаг нужен, чтобы после восстановления состояния из БД часы
продолжали идти по тем же правилам.

Revision ID: e4b9c2d7a1f3
Revises: d3a8f1c6e2b7
Create Date: 2026-11-20 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4b9c2d7a1f3'
down_revision: str | Sequence[str] | None = 'd3a8f1c6e2b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('games', sa.Column('hourglass', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('games', 'hourglass')
