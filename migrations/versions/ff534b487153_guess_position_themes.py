"""guess position themes

Revision ID: ff534b487153
Revises: 5c657e5a912e
Create Date: 2026-11-16 12:54:07.939270

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'ff534b487153'
down_revision: str | Sequence[str] | None = '5c657e5a912e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('guess_positions', sa.Column('themes', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('guess_positions', 'themes')
