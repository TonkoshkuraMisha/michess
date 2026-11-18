"""arena awards (task 33.5): podium places of finished arenas

Revision ID: e6b1c9d4a7f2
Revises: d3f8a2c6e914
Create Date: 2026-11-18 15:00:00.000000

Таблица arena_awards: тройка таблицы итогов законченной арены или швейцарки (src/services/arena_awards.py). Уже
закончившиеся арены награды не получают: задача смотрит только арены, конец которых был не раньше LOOKBACK назад.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e6b1c9d4a7f2'
down_revision: str | Sequence[str] | None = 'd3f8a2c6e914'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'arena_awards',
        sa.Column('arena_id', sa.Integer(), nullable=False),
        sa.Column('place', sa.String(length=1), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("place IN ('1', '2', '3')", name='ck_arena_awards_place'),
        sa.ForeignKeyConstraint(['arena_id'], ['arenas.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('arena_id', 'place'),
        sa.UniqueConstraint('arena_id', 'user_id', name='uq_arena_award_player'),
    )
    op.create_index('ix_arena_awards_user_id', 'arena_awards', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_arena_awards_user_id', table_name='arena_awards')
    op.drop_table('arena_awards')
