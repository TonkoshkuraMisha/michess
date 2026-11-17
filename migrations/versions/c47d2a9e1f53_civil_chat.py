"""civil chat (task 30.3): held flags, hidden_conversations

Revision ID: c47d2a9e1f53
Revises: b81f5c2e7a94
Create Date: 2026-11-17 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c47d2a9e1f53'
down_revision: str | Sequence[str] | None = 'b81f5c2e7a94'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'hidden_conversations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('other_id', sa.Integer(), nullable=False),
        sa.Column('up_to_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['other_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'other_id', name='uq_hidden_conversation'),
    )
    op.create_index(op.f('ix_hidden_conversations_user_id'), 'hidden_conversations', ['user_id'], unique=False)
    for table in ('direct_messages', 'posts', 'post_comments'):
        op.add_column(table, sa.Column('held', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    for table in ('post_comments', 'posts', 'direct_messages'):
        op.drop_column(table, 'held')
    op.drop_index(op.f('ix_hidden_conversations_user_id'), table_name='hidden_conversations')
    op.drop_table('hidden_conversations')
