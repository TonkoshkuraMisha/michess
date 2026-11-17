"""arena schedule (task 33.4): arenas.conference, arena_reminders

Revision ID: d9e1b7c3a246
Revises: c4d8a2e6f135
Create Date: 2026-11-18 05:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd9e1b7c3a246'
down_revision: str | Sequence[str] | None = 'c4d8a2e6f135'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('arenas', sa.Column('conference', sa.String(length=16), nullable=True))
    op.create_table('arena_reminders',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('arena_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['arena_id'], ['arenas.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('arena_id', 'user_id', name='uq_arena_reminder')
    )
    op.create_index(op.f('ix_arena_reminders_arena_id'), 'arena_reminders', ['arena_id'], unique=False)
    op.create_index(op.f('ix_arena_reminders_user_id'), 'arena_reminders', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_arena_reminders_user_id'), table_name='arena_reminders')
    op.drop_index(op.f('ix_arena_reminders_arena_id'), table_name='arena_reminders')
    op.drop_table('arena_reminders')
    op.drop_column('arenas', 'conference')
