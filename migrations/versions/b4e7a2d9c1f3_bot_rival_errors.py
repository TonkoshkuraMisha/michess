"""bot rival errors (task 32.2): bot_rival_stats.errors, bot_rivals.errors_game_id

Revision ID: b4e7a2d9c1f3
Revises: a8d3f6c2e5b7
Create Date: 2026-11-18 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4e7a2d9c1f3'
down_revision: str | Sequence[str] | None = 'a8d3f6c2e5b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('bot_rival_stats', sa.Column('errors', sa.Integer(), server_default='0', nullable=False))
    op.add_column('bot_rivals', sa.Column('errors_game_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('bot_rivals', 'errors_game_id')
    op.drop_column('bot_rival_stats', 'errors')
