"""users.terms_version, users.terms_accepted_at: consent to the terms at registration (task 23.1)

Редакция документов и момент согласия игрока (src/services/legal.py). У существующих аккаунтов — NULL.

Revision ID: e5b1c9a7d3f2
Revises: d3a8f1c6e2b7
Create Date: 2026-11-21 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5b1c9a7d3f2'
down_revision: str | Sequence[str] | None = 'd3a8f1c6e2b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Два необязательных столбца в users."""
    op.add_column('users', sa.Column('terms_version', sa.String(length=16), nullable=True))
    op.add_column('users', sa.Column('terms_accepted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Убирает столбцы согласия."""
    op.drop_column('users', 'terms_accepted_at')
    op.drop_column('users', 'terms_version')
