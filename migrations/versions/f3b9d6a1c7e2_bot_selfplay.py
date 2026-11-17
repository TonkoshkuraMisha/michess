"""bot self-play tuning (task 32.3): bot_tunings, bot_tuning_log

Revision ID: f3b9d6a1c7e2
Revises: e5a8c1f2b6d4
Create Date: 2026-11-17 23:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f3b9d6a1c7e2'
down_revision: str | Sequence[str] | None = 'e5a8c1f2b6d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bot_tunings',
        sa.Column('key', sa.String(length=40), nullable=False),
        sa.Column('randomness', sa.Integer(), nullable=False),
        sa.Column('blunder_guard_cp', sa.Integer(), nullable=False),
        sa.Column('games', sa.Integer(), server_default='0', nullable=False),
        sa.Column('points', sa.Float(), server_default='0', nullable=False),
        sa.Column('opponents_rating', sa.Float(), server_default='0', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )
    op.create_table(
        'bot_tuning_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=40), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('games', sa.Integer(), nullable=False),
        sa.Column('measured', sa.Integer(), nullable=False),
        sa.Column('target', sa.Integer(), nullable=False),
        sa.Column('randomness_before', sa.Integer(), nullable=False),
        sa.Column('randomness_after', sa.Integer(), nullable=False),
        sa.Column('guard_before', sa.Integer(), nullable=False),
        sa.Column('guard_after', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_bot_tuning_log_created_at'), 'bot_tuning_log', ['created_at'], unique=False)
    op.create_index(op.f('ix_bot_tuning_log_key'), 'bot_tuning_log', ['key'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bot_tuning_log_key'), table_name='bot_tuning_log')
    op.drop_index(op.f('ix_bot_tuning_log_created_at'), table_name='bot_tuning_log')
    op.drop_table('bot_tuning_log')
    op.drop_table('bot_tunings')
