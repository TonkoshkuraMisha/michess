"""direct messages (task 30.1): direct_messages, blocks, users.dm_policy

Revision ID: a3c71e9d4b20
Revises: 56b0faf576e5
Create Date: 2026-11-17 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3c71e9d4b20'
down_revision: str | Sequence[str] | None = '56b0faf576e5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'direct_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pair_key', sa.String(length=24), nullable=False),
        sa.Column('sender_id', sa.Integer(), nullable=False),
        sa.Column('recipient_id', sa.Integer(), nullable=False),
        sa.Column('body', sa.String(length=1000), server_default='', nullable=False),
        sa.Column('attachment', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_direct_messages_pair_id', 'direct_messages', ['pair_key', 'id'], unique=False)
    op.create_index(op.f('ix_direct_messages_recipient_id'), 'direct_messages', ['recipient_id'], unique=False)
    op.create_index(op.f('ix_direct_messages_sender_id'), 'direct_messages', ['sender_id'], unique=False)
    op.create_table(
        'blocks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('blocker_id', sa.Integer(), nullable=False),
        sa.Column('blocked_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['blocked_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['blocker_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('blocker_id', 'blocked_id', name='uq_block_pair'),
    )
    op.create_index(op.f('ix_blocks_blocked_id'), 'blocks', ['blocked_id'], unique=False)
    op.create_index(op.f('ix_blocks_blocker_id'), 'blocks', ['blocker_id'], unique=False)
    op.add_column('users', sa.Column('dm_policy', sa.String(length=16), server_default='all', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'dm_policy')
    op.drop_index(op.f('ix_blocks_blocker_id'), table_name='blocks')
    op.drop_index(op.f('ix_blocks_blocked_id'), table_name='blocks')
    op.drop_table('blocks')
    op.drop_index(op.f('ix_direct_messages_sender_id'), table_name='direct_messages')
    op.drop_index(op.f('ix_direct_messages_recipient_id'), table_name='direct_messages')
    op.drop_index('ix_direct_messages_pair_id', table_name='direct_messages')
    op.drop_table('direct_messages')
