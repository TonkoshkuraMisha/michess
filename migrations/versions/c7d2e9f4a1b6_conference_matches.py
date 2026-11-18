"""conference matches (task 33.6): arena format "match", arenas.opponent_conference, arena_players.board

Revision ID: c7d2e9f4a1b6
Revises: b4e7a2d9c1f3
Create Date: 2026-11-18 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7d2e9f4a1b6'
down_revision: str | Sequence[str] | None = 'b4e7a2d9c1f3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('arenas', sa.Column('opponent_conference', sa.String(length=16), nullable=True))
    op.add_column('arena_players', sa.Column('board', sa.Integer(), nullable=True))
    op.drop_constraint('ck_arenas_format', 'arenas', type_='check')
    op.create_check_constraint('ck_arenas_format', 'arenas', "format IN ('arena', 'swiss', 'match')")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM arenas WHERE format = 'match'")
    op.drop_constraint('ck_arenas_format', 'arenas', type_='check')
    op.create_check_constraint('ck_arenas_format', 'arenas', "format IN ('arena', 'swiss')")
    op.drop_column('arena_players', 'board')
    op.drop_column('arenas', 'opponent_conference')
