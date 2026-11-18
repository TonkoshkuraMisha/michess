"""position index natural keys (audit 29.1, finding 1): composite primary keys instead of surrogate id

Revision ID: c9a4e7d2f5b8
Revises: 59c61fc287c2
Create Date: 2026-11-18 13:00:00.000000

position_stats: ключ (position_hash, move_uci), position_games: ключ (position_hash, game_id). Раньше у обеих был
суррогатный id (им никто не пользовался) плюс уникальный индекс по тем же парам — теперь эта пара и есть первичный
ключ, лишние колонка и индекс уходят. Поведение не меняется: вставка индекса идёт ON CONFLICT по тем же колонкам.
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c9a4e7d2f5b8'
down_revision: str | Sequence[str] | None = '59c61fc287c2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (таблица, колонки ключа, имя прежнего уникального ограничения)
TABLES = (
    ('position_stats', ('position_hash', 'move_uci'), 'uq_position_stats_move'),
    ('position_games', ('position_hash', 'game_id'), 'uq_position_games_game'),
)


def upgrade() -> None:
    """Upgrade schema."""
    for table, columns, unique in TABLES:
        op.drop_constraint(unique, table, type_='unique')
        op.drop_column(table, 'id')  # вместе с ней уходит прежний первичный ключ
        op.create_primary_key(f'{table}_pkey', table, list(columns))


def downgrade() -> None:
    """Downgrade schema: the surrogate id and the unique constraints come back."""
    for table, columns, unique in reversed(TABLES):
        op.drop_constraint(f'{table}_pkey', table, type_='primary')
        op.execute(f'ALTER TABLE {table} ADD COLUMN id SERIAL PRIMARY KEY')
        op.create_unique_constraint(unique, table, list(columns))
