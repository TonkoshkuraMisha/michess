# --- FILE: migrations/versions/d9f4a1b2c3e4_add_metadata_columns_to_games.py ---

"""add_metadata_columns_to_games

Revision ID: d9f4a1b2c3e4
Revises: c8a91e2f4b10
Create Date: 2026-11-05 22:30:00.000000

"""
import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9f4a1b2c3e4"
down_revision: str | Sequence[str] | None = "c8a91e2f4b10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DATE_RE = re.compile(r'\[(?:Event)?Date\s+"([^"]+)"\]')
SITE_RE = re.compile(r'\[Site\s+"([^"]+)"\]')
ECO_RE = re.compile(r'\[ECO\s+"([^"]+)"\]')
RESULT_RE = re.compile(r'\[Result\s+"([^"]+)"\]')


def upgrade() -> None:
    op.add_column("games", sa.Column("pgn_date", sa.String(length=20), nullable=True))
    op.add_column("games", sa.Column("site", sa.String(length=100), nullable=True))
    op.add_column("games", sa.Column("eco", sa.String(length=10), nullable=True))

    op.create_index(op.f("ix_games_pgn_date"), "games", ["pgn_date"], unique=False)
    op.create_index(op.f("ix_games_site"), "games", ["site"], unique=False)
    op.create_index(op.f("ix_games_eco"), "games", ["eco"], unique=False)
    op.create_index(op.f("ix_games_white_player_id"), "games", ["white_player_id"], unique=False)
    op.create_index(op.f("ix_games_black_player_id"), "games", ["black_player_id"], unique=False)
    op.create_index(op.f("ix_games_status"), "games", ["status"], unique=False)
    op.create_index(op.f("ix_games_finished_at"), "games", ["finished_at"], unique=False)

    # Бэкфилл метаданных для уже существующих в базе партий
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, pgn, result FROM games WHERE pgn IS NOT NULL AND pgn != ''")).fetchall()
    for row in rows:
        game_id, pgn_text, cur_result = row[0], row[1], row[2]
        pgn_date = None
        site = None
        eco = None
        res_val = cur_result

        for m in DATE_RE.finditer(pgn_text):
            val = m.group(1).strip()
            if val and not val.startswith("?"):
                pgn_date = val[:20]
                break

        s_match = SITE_RE.search(pgn_text)
        if s_match and s_match.group(1).strip() != "?":
            site = s_match.group(1).strip()[:100]

        e_match = ECO_RE.search(pgn_text)
        if e_match and e_match.group(1).strip() != "?":
            eco = e_match.group(1).strip()[:10]

        if not res_val or res_val == "*":
            r_match = RESULT_RE.search(pgn_text)
            if r_match:
                res_val = r_match.group(1).strip()[:10]

        bind.execute(
            sa.text(
                "UPDATE games SET pgn_date = :d, site = :s, eco = :e, result = :r WHERE id = :id"
            ),
            {"d": pgn_date, "s": site, "e": eco, "r": res_val, "id": game_id},
        )


def downgrade() -> None:
    op.drop_index(op.f("ix_games_finished_at"), table_name="games")
    op.drop_index(op.f("ix_games_status"), table_name="games")
    op.drop_index(op.f("ix_games_black_player_id"), table_name="games")
    op.drop_index(op.f("ix_games_white_player_id"), table_name="games")
    op.drop_index(op.f("ix_games_eco"), table_name="games")
    op.drop_index(op.f("ix_games_site"), table_name="games")
    op.drop_index(op.f("ix_games_pgn_date"), table_name="games")
    op.drop_column("games", "eco")
    op.drop_column("games", "site")
    op.drop_column("games", "pgn_date")
