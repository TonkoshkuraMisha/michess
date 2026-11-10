# --- FILE: migrations/versions/e5b7c9d1a2f3_add_username_key_to_users.py ---

"""add_username_key_to_users

Нормализованное имя (casefold) для аккаунтов с паролем: уникальность без учёта регистра и
вход в любом регистре. У архивных игроков из PGN и ботов остаётся NULL — их имена из
заголовков партий могут законно различаться только регистром.

Revision ID: e5b7c9d1a2f3
Revises: d9f4a1b2c3e4
Create Date: 2026-11-10 18:00:00.000000

"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5b7c9d1a2f3"
down_revision: Union[str, Sequence[str], None] = "d9f4a1b2c3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

# Маркеры вместо хэша пароля у аккаунтов, под которыми войти нельзя.
NO_LOGIN_MARKERS = ("!historical_archive_no_login!", "!historical_bot_no_login!")


def upgrade() -> None:
    op.add_column("users", sa.Column("username_key", sa.String(length=50), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, username, hashed_password FROM users ORDER BY id")
    ).fetchall()

    # Ключ вычисляется в Python (casefold), а не lower() в SQL: lower() в PostgreSQL с локалью C
    # и в SQLite не приводит кириллицу. При совпадении ключей ключ получает самый старый
    # аккаунт; остальные остаются без ключа и по-прежнему входят под точным именем.
    taken: dict[str, int] = {}
    for user_id, username, hashed_password in rows:
        if hashed_password in NO_LOGIN_MARKERS or not username:
            continue
        key = username.strip().casefold()[:50]
        if key in taken:
            logger.warning(
                "users.username_key: '%s' (id=%s) differs only in case from id=%s; left without key",
                username, user_id, taken[key],
            )
            continue
        taken[key] = user_id
        bind.execute(
            sa.text("UPDATE users SET username_key = :key WHERE id = :id"),
            {"key": key, "id": user_id},
        )

    op.create_index(op.f("ix_users_username_key"), "users", ["username_key"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_username_key"), table_name="users")
    op.drop_column("users", "username_key")
