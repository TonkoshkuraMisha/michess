"""Position index of library games for the opening explorer examples (task 8b)

Revision ID: a8d3f6c2e5b7
Revises: f2a7c4e9b1d6
Create Date: 2026-11-18 18:00:00.000000

Партии публичных коллекций библиотеки показываются под позицией в справочнике дебютов как примеры. Для этого —
своя таблица позиций position_library_games (как position_games у партий сайта и архива) и отметка
library_games.positions_indexed. В статистику ходов (position_stats) партии библиотеки не входят: многие из них есть и
в архиве чемпионов. Заполняет таблицу импорт библиотеки, а уже загруженные партии — scripts/build_position_index.py
--library. Откат удаляет таблицу и отметку; индекс собирается заново тем же скриптом.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a8d3f6c2e5b7'
down_revision: str | Sequence[str] | None = 'f2a7c4e9b1d6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create position_library_games and the indexed flag on library games."""
    op.create_table(
        'position_library_games',
        sa.Column('position_hash', sa.BigInteger(), nullable=False),
        sa.Column('library_game_id', sa.Integer(), nullable=False),
        sa.Column('ply', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['library_game_id'], ['library_games.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('position_hash', 'library_game_id'),
    )
    op.create_index(op.f('ix_position_library_games_library_game_id'), 'position_library_games', ['library_game_id'],
                    unique=False)
    op.add_column('library_games', sa.Column('positions_indexed', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Drop the table and the flag."""
    op.drop_column('library_games', 'positions_indexed')
    op.drop_index(op.f('ix_position_library_games_library_game_id'), table_name='position_library_games')
    op.drop_table('position_library_games')
