"""arena groups (task 33.2): arenas.max_rating, division, parent_id

Revision ID: a7c3e5f9b214
Revises: f3b9d6a1c7e2
Create Date: 2026-11-18 00:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7c3e5f9b214'
down_revision: str | Sequence[str] | None = 'f3b9d6a1c7e2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('arenas', sa.Column('max_rating', sa.Integer(), nullable=True))
    op.add_column('arenas', sa.Column('division', sa.Integer(), server_default='1', nullable=False))
    op.add_column('arenas', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_arenas_parent_id'), 'arenas', ['parent_id'], unique=False)
    op.create_foreign_key('fk_arenas_parent_id_arenas', 'arenas', 'arenas', ['parent_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_arenas_parent_id_arenas', 'arenas', type_='foreignkey')
    op.drop_index(op.f('ix_arenas_parent_id'), table_name='arenas')
    op.drop_column('arenas', 'parent_id')
    op.drop_column('arenas', 'division')
    op.drop_column('arenas', 'max_rating')
