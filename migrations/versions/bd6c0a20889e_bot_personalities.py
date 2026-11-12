# --- FILE: migrations/versions/bd6c0a20889e_bot_personalities.py ---

"""bot_personalities

Мастерская соперников (таск 10.2): персоналии, собранные игроком, — имя и конфиг ползунков в JSON,
не больше 20 на игрока, имя уникально у владельца без учёта регистра. У партии — имя персоналии,
с которой она сыграна: в базе соперник — общий бот-пользователь, в архиве видно имя персоналии.

Revision ID: bd6c0a20889e
Revises: a4d2e8f1c6b9
Create Date: 2026-11-12 20:08:02.458394

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bd6c0a20889e"
down_revision: str | Sequence[str] | None = "a4d2e8f1c6b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("bot_personalities",
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("owner_id", sa.Integer(), nullable=False),
    sa.Column("name", sa.String(length=30), nullable=False),
    sa.Column("name_key", sa.String(length=30), nullable=False),
    sa.Column("config_json", sa.Text(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id"),
    sa.UniqueConstraint("owner_id", "name_key", name="uq_bot_personalities_owner_name")
    )
    op.create_index(op.f("ix_bot_personalities_id"), "bot_personalities", ["id"], unique=False)
    op.create_index(op.f("ix_bot_personalities_owner_id"), "bot_personalities", ["owner_id"], unique=False)
    op.add_column("games", sa.Column("personality_name", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("games", "personality_name")
    op.drop_index(op.f("ix_bot_personalities_owner_id"), table_name="bot_personalities")
    op.drop_index(op.f("ix_bot_personalities_id"), table_name="bot_personalities")
    op.drop_table("bot_personalities")
