# --- FILE: migrations/versions/f6c8d0e2b3a4_add_token_version_to_users.py ---

"""add_token_version_to_users

Версия токенов пользователя: входит в JWT, её увеличение отзывает все выданные токены
(смена пароля, «выйти на всех устройствах").

Revision ID: f6c8d0e2b3a4
Revises: e5b7c9d1a2f3
Create Date: 2026-11-10 20:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6c8d0e2b3a4"
down_revision: Union[str, Sequence[str], None] = "e5b7c9d1a2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
