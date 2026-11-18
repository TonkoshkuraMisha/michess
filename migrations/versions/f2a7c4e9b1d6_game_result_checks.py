"""CHECK on games.result and imported_games.result after normalizing foreign PGN result tags (audit 29.1, finding 3)

Revision ID: f2a7c4e9b1d6
Revises: e6b1c9d4a7f2
Create Date: 2026-11-18 16:00:00.000000

Итог из заголовка Result чужого PGN раньше записывался как есть. Теперь импорт и загрузчик архива приводят его
game_engine.normalize_result; здесь то же делается с уже записанными строками (известные варианты — к стандарту,
прочее — «*»), после чего ставится CHECK: в колонке только 1-0, 0-1, 1/2-1/2, * (или NULL у незаконченной партии).
Откат снимает CHECK; приведённые значения не возвращаются (их исходный вид не хранился).
"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f2a7c4e9b1d6'
down_revision: str | Sequence[str] | None = 'e6b1c9d4a7f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ALLOWED = "('1-0', '0-1', '1/2-1/2', '*')"
# Варианты записи → стандарт (как game_engine._RESULT_ALIASES на момент миграции).
ALIASES = {"½-½": "1/2-1/2", "1/2": "1/2-1/2", "0.5-0.5": "1/2-1/2", "=": "1/2-1/2", "1:0": "1-0", "0:1": "0-1",
           "1–0": "1-0", "0–1": "0-1"}
TABLES = ('games', 'imported_games')


def upgrade() -> None:
    """Normalize stored result tags, then add the CHECK constraints."""
    for table in TABLES:
        for alias, standard in ALIASES.items():
            op.execute(f"UPDATE {table} SET result = '{standard}' WHERE trim(result) = '{alias}'")
        op.execute(f"UPDATE {table} SET result = trim(result) WHERE result <> trim(result)")
        op.execute(f"UPDATE {table} SET result = '*' WHERE result IS NOT NULL AND result NOT IN {ALLOWED}")
        op.create_check_constraint(f'ck_{table}_result', table, f'result IN {ALLOWED}')


def downgrade() -> None:
    """Drop the CHECK constraints."""
    for table in reversed(TABLES):
        op.drop_constraint(f'ck_{table}_result', table, type_='check')
