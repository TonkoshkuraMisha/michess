# --- FILE: migrations/versions/d3287fae972e_game_is_simulation.py ---

"""game_is_simulation

Пометка партий ботов между собой, сыгранных сервером в турнире (таск 15.2): такие партии не попадают в архив и
статистику профилей; время, когда воркер забрал партию турнира (защита от двойного счёта).

Revision ID: d3287fae972e
Revises: a5db857ccde4
Create Date: 2026-11-13 17:21:09.980998

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3287fae972e"
down_revision: str | Sequence[str] | None = "a5db857ccde4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("games", sa.Column("is_simulation", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("tournament_games", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tournament_games", "started_at")
    op.drop_column("games", "is_simulation")
