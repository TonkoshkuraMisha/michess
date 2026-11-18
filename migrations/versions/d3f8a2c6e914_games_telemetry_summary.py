"""games.telemetry_summary (owner's plan 18.11, task 9): move telemetry summary kept after raw moves expire

Revision ID: d3f8a2c6e914
Revises: b4d2e8f1a6c3
Create Date: 2026-11-18 14:00:00.000000

Сводка телеметрии ходов по сторонам (src/services/anticheat.telemetry_summary). Сырые строки moves удаляет плановая
задача через telemetry_retention.RETENTION_DAYS после окончания партии, сводка остаётся. Уже сыгранные партии
получат сводку, когда до них дойдёт эта задача.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd3f8a2c6e914'
down_revision: str | Sequence[str] | None = 'b4d2e8f1a6c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('games', sa.Column('telemetry_summary', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('games', 'telemetry_summary')
