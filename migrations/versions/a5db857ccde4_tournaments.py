# --- FILE: migrations/versions/a5db857ccde4_tournaments.py ---

"""tournaments

Турниры с историческими мастерами (таск 15.1): турнир (формат, размер, контроль, текущий круг), участники с
посевом (игрок, исторический бот, архетип или копия персоналии мастерской) и партии турнира со стадией матча.

Revision ID: a5db857ccde4
Revises: a98ddca02ebe
Create Date: 2026-11-13 17:02:38.691091

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5db857ccde4"
down_revision: str | Sequence[str] | None = "a98ddca02ebe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("tournaments",
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("owner_id", sa.Integer(), nullable=False),
    sa.Column("format", sa.String(length=16), nullable=False),
    sa.Column("size", sa.Integer(), nullable=False),
    sa.Column("status", sa.String(length=16), nullable=False),
    sa.Column("base_time_ms", sa.Integer(), nullable=False),
    sa.Column("increment_ms", sa.Integer(), nullable=False),
    sa.Column("current_round", sa.Integer(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id")
    )
    op.create_index(op.f("ix_tournaments_owner_id"), "tournaments", ["owner_id"], unique=False)
    op.create_index(op.f("ix_tournaments_status"), "tournaments", ["status"], unique=False)
    op.create_table("tournament_games",
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("tournament_id", sa.Integer(), nullable=False),
    sa.Column("round", sa.Integer(), nullable=False),
    sa.Column("board", sa.Integer(), nullable=False),
    sa.Column("stage", sa.String(length=16), nullable=False),
    sa.Column("white_seat", sa.Integer(), nullable=False),
    sa.Column("black_seat", sa.Integer(), nullable=False),
    sa.Column("base_time_ms", sa.Integer(), nullable=False),
    sa.Column("increment_ms", sa.Integer(), nullable=False),
    sa.Column("result", sa.String(length=8), nullable=True),
    sa.Column("game_id", sa.Integer(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id")
    )
    op.create_index(op.f("ix_tournament_games_tournament_id"), "tournament_games", ["tournament_id"], unique=False)
    op.create_table("tournament_players",
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("tournament_id", sa.Integer(), nullable=False),
    sa.Column("seat", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(length=16), nullable=False),
    sa.Column("user_id", sa.Integer(), nullable=True),
    sa.Column("bot_key", sa.String(length=64), nullable=True),
    sa.Column("personality_name", sa.String(length=30), nullable=True),
    sa.Column("config_json", sa.Text(), nullable=True),
    sa.Column("rating", sa.Integer(), nullable=False),
    sa.Column("place", sa.Integer(), nullable=True),
    sa.Column("eliminated_round", sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    sa.PrimaryKeyConstraint("id"),
    sa.UniqueConstraint("tournament_id", "seat", name="uq_tournament_players_seat")
    )
    op.create_index(op.f("ix_tournament_players_tournament_id"), "tournament_players", ["tournament_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tournament_players_tournament_id"), table_name="tournament_players")
    op.drop_table("tournament_players")
    op.drop_index(op.f("ix_tournament_games_tournament_id"), table_name="tournament_games")
    op.drop_table("tournament_games")
    op.drop_index(op.f("ix_tournaments_status"), table_name="tournaments")
    op.drop_index(op.f("ix_tournaments_owner_id"), table_name="tournaments")
    op.drop_table("tournaments")
