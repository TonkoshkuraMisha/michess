"""arena berserk (task 33.3): arena_games.white_berserk, black_berserk

Revision ID: c4d8a2e6f135
Revises: a7c3e5f9b214
Create Date: 2026-11-18 03:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4d8a2e6f135'
down_revision: str | Sequence[str] | None = 'a7c3e5f9b214'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('arena_games', sa.Column('white_berserk', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('arena_games', sa.Column('black_berserk', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('arena_games', 'black_berserk')
    op.drop_column('arena_games', 'white_berserk')
