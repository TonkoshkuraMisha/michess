# --- FILE: migrations/versions/b7e3f1a9c2d4_add_is_bot_to_users.py ---

"""add_is_bot_to_users

Исторических ботов (играбельных AI-соперников) и архивных исторических игроков (партии из
PGN-архивов, посмотреть — нельзя сыграть) до сих пор опознавали по служебному маркеру в
hashed_password. Явная колонка надёжнее и позволяет убрать их из таблицы лидеров одним
условием, а не угадыванием по строке пароля в каждом запросе.

Revision ID: b7e3f1a9c2d4
Revises: f6c8d0e2b3a4
Create Date: 2026-11-11 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7e3f1a9c2d4"
down_revision: str | Sequence[str] | None = "f6c8d0e2b3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Те же маркеры, что в src/api/bots.py (BOT_PASSWORD_MARKER) и src/db/seed.py.
NO_LOGIN_MARKERS = ("!historical_bot_no_login!", "!historical_archive_no_login!")


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_bot", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    bind = op.get_bind()
    bind.execute(
        sa.text("UPDATE users SET is_bot = true WHERE hashed_password IN :markers").bindparams(
            sa.bindparam("markers", expanding=True)
        ),
        {"markers": list(NO_LOGIN_MARKERS)},
    )


def downgrade() -> None:
    op.drop_column("users", "is_bot")
