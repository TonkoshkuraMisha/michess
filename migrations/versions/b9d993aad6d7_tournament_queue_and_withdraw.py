# --- FILE: migrations/versions/b9d993aad6d7_tournament_queue_and_withdraw.py ---

"""tournament_queue_and_withdraw

Самопроверка 13.11 (таски A.1, A.3): время постановки партии ботов в очередь — чтобы опрос страницы турнира
не публиковал её снова и снова; время, когда игрок сдал турнир — сданный турнир не мешает начать новый.

Revision ID: b9d993aad6d7
Revises: d3287fae972e
Create Date: 2026-11-13 23:13:33.219629

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9d993aad6d7"
down_revision: str | Sequence[str] | None = "d3287fae972e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tournament_games", sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tournaments", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tournaments", "withdrawn_at")
    op.drop_column("tournament_games", "queued_at")
