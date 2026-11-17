"""bot rivalry (task 32.2): bot_rivals, bot_rival_stats

Revision ID: e5a8c1f2b6d4
Revises: d92e4b7c3a18
Create Date: 2026-11-17 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5a8c1f2b6d4'
down_revision: str | Sequence[str] | None = 'd92e4b7c3a18'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bot_rivals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.String(length=40), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('points', sa.Float(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('bot_id', 'user_id', name='uq_bot_rival'),
    )
    op.create_index(op.f('ix_bot_rivals_user_id'), 'bot_rivals', ['user_id'], unique=False)
    op.create_table(
        'bot_rival_stats',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_id', sa.String(length=40), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('fen_key', sa.String(length=100), nullable=False),
        sa.Column('uci', sa.String(length=5), nullable=False),
        sa.Column('games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('points', sa.Float(), server_default='0', nullable=False),
        sa.Column('last_lost', sa.Boolean(), server_default='false', nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('bot_id', 'user_id', 'fen_key', 'uci', name='uq_bot_rival_stat'),
    )
    op.create_index(op.f('ix_bot_rival_stats_user_id'), 'bot_rival_stats', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bot_rival_stats_user_id'), table_name='bot_rival_stats')
    op.drop_table('bot_rival_stats')
    op.drop_index(op.f('ix_bot_rivals_user_id'), table_name='bot_rivals')
    op.drop_table('bot_rivals')
