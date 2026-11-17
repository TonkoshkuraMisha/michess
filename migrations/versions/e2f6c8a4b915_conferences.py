"""conferences (task 33.6): users.country, users.country_season, arena_players.conference

Revision ID: e2f6c8a4b915
Revises: d9e1b7c3a246
Create Date: 2026-11-18 07:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e2f6c8a4b915'
down_revision: str | Sequence[str] | None = 'd9e1b7c3a246'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('country', sa.String(length=2), nullable=True))
    op.add_column('users', sa.Column('country_season', sa.String(length=7), nullable=True))
    op.add_column('arena_players', sa.Column('conference', sa.String(length=16), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('arena_players', 'conference')
    op.drop_column('users', 'country_season')
    op.drop_column('users', 'country')
