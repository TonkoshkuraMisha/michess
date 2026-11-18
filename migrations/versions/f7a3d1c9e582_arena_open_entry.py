"""arena open entry (owner's decision 17.11.2026): drop arenas.max_rating

Revision ID: f7a3d1c9e582
Revises: e2f6c8a4b915
Create Date: 2026-11-18 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f7a3d1c9e582'
down_revision: str | Sequence[str] | None = 'e2f6c8a4b915'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: arenas restricted by a rating ceiling no longer exist."""
    op.drop_column('arenas', 'max_rating')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('arenas', sa.Column('max_rating', sa.Integer(), nullable=True))
