"""bot memory (task 32.1): bot_opening_stats, bot_ratings

Revision ID: d92e4b7c3a18
Revises: c47d2a9e1f53
Create Date: 2026-11-17 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd92e4b7c3a18'
down_revision: str | Sequence[str] | None = 'c47d2a9e1f53'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bot_opening_stats',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.String(length=40), nullable=False),
        sa.Column('fen_key', sa.String(length=100), nullable=False),
        sa.Column('uci', sa.String(length=5), nullable=False),
        sa.Column('games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('points', sa.Float(), server_default='0', nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('bot_id', 'fen_key', 'uci', name='uq_bot_opening_stat'),
    )
    op.create_index(op.f('ix_bot_opening_stats_bot_id'), 'bot_opening_stats', ['bot_id'], unique=False)
    op.create_table(
        'bot_ratings',
        sa.Column('bot_id', sa.String(length=40), nullable=False),
        sa.Column('rating', sa.Float(), nullable=False),
        sa.Column('games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('offset', sa.Integer(), server_default='0', nullable=False),
        sa.Column('offset_games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('bot_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('bot_ratings')
    op.drop_index(op.f('ix_bot_opening_stats_bot_id'), table_name='bot_opening_stats')
    op.drop_table('bot_opening_stats')
