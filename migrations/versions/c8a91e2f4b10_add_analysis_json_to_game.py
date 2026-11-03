# --- FILE: migrations/versions/c8a91e2f4b10_add_analysis_json_to_game.py ---

"""add_analysis_json_to_game

Revision ID: c8a91e2f4b10
Revises: 4101ce4b6d90
Create Date: 2026-11-03 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c8a91e2f4b10"
down_revision: Union[str, Sequence[str], None] = "4101ce4b6d90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("games", sa.Column("analysis_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("games", "analysis_json")
