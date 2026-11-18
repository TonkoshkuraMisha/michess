"""db integrity (audit 29.1, findings 3-5): indexes on foreign keys, explicit RESTRICT, CHECK on enumerations

Revision ID: 59c61fc287c2
Revises: f7a3d1c9e582
Create Date: 2026-11-18 07:10:54.557345

Индексы — на каждую ссылку, по которой идёт каскад или SET NULL при удалении игрока, партии или выборка (без них
удаление игрока читало бы целиком arena_games, reports, tournament_players …). RESTRICT — у ссылок партий и ходов
на игроков: игрока с партиями не удаляют, аккаунт обезличивается (src/services/account.py); поведение то же, что
было по умолчанию (NO ACTION), теперь записано явно. CHECK — значения-перечисления из кортежей в моделях
(src/models/base.one_of). Перед созданием CHECK миграция ищет строки с недопустимым значением и останавливается с
их списком, а не ломает данные молча.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '59c61fc287c2'
down_revision: str | Sequence[str] | None = 'f7a3d1c9e582'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (таблица, колонка) — индекс ix_<таблица>_<колонка>.
INDEXES = (
    ('arena_games', 'white_id'), ('arena_games', 'black_id'),
    ('feedback', 'user_id'), ('feedback', 'moderator_id'),
    ('games', 'winner_id'),
    ('hidden_conversations', 'other_id'),
    ('invites', 'created_by'),
    ('library_annotations', 'author_id'), ('library_collections', 'owner_id'),
    ('moves', 'player_id'),
    ('reports', 'reporter_id'), ('reports', 'game_id'), ('reports', 'moderator_id'),
    ('tournament_games', 'game_id'), ('tournament_players', 'user_id'),
)
# (таблица, колонка, ссылка на таблицу) — внешний ключ <таблица>_<колонка>_fkey становится RESTRICT.
RESTRICT = (
    ('games', 'white_player_id', 'users'), ('games', 'black_player_id', 'users'), ('games', 'winner_id', 'users'),
    ('moves', 'game_id', 'games'), ('moves', 'player_id', 'users'),
)
RESULTS = ('1-0', '0-1', '1/2-1/2', '*')
# Снимок наборов на момент миграции (дальше наборы живут в моделях, новое значение — новая миграция).
CHECKS = (
    ('arenas', 'format', ('arena', 'swiss')),
    ('arena_games', 'result', RESULTS),
    ('feedback', 'status', ('new', 'in_progress', 'done', 'rejected')),
    ('imported_games', 'source', ('lichess', 'chesscom', 'pgn')),
    ('imported_games', 'color', ('white', 'black')),
    ('library_collections', 'visibility', ('public', 'owner', 'staff')),
    ('library_games', 'result', RESULTS),
    ('library_annotations', 'status', ('auto', 'draft', 'review', 'approved')),
    ('reports', 'kind', ('player', 'message', 'cheat_review', 'appeal', 'translation', 'content', 'held')),
    ('reports', 'reason', ('cheating', 'abuse', 'spam', 'other', 'auto')),
    ('reports', 'status', ('open', 'resolved')),
    ('reports', 'action', ('dismiss', 'warn', 'chat_ban', 'mark_cheater', 'clear_cheater', 'accept', 'hide', 'release')),
    ('defense_drills', 'kind', ('threat', 'blunder')),
    ('repertoires', 'color', ('white', 'black')),
    ('tournaments', 'format', ('round_robin', 'knockout', 'swiss')),
    ('tournaments', 'status', ('active', 'finished')),
    ('tournament_players', 'kind', ('user', 'bot', 'archetype', 'personality')),
    ('tournament_games', 'stage', ('main', 'rematch', 'armageddon')),
    ('tournament_games', 'result', ('1-0', '0-1', '1/2-1/2')),
    ('users', 'dm_policy', ('all', 'following', 'nobody')),
)


def _listed(values: tuple[str, ...]) -> str:
    return ', '.join(f"'{value}'" for value in values)


def upgrade() -> None:
    """Upgrade schema."""
    for table, column in INDEXES:
        op.create_index(f'ix_{table}_{column}', table, [column], unique=False)
    for table, column, target in RESTRICT:
        name = f'{table}_{column}_fkey'
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, target, [column], ['id'], ondelete='RESTRICT')
    bind = op.get_bind()
    bad = []
    for table, column, values in CHECKS:
        found = bind.execute(sa.text(
            f'SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL AND {column} NOT IN ({_listed(values)})'
        )).scalars().all()
        if found:
            bad.append(f'{table}.{column}: {found}')
    if bad:
        raise RuntimeError('Values outside the allowed sets, fix the data first: ' + '; '.join(bad))
    for table, column, values in CHECKS:
        op.create_check_constraint(f'ck_{table}_{column}', table, f'{column} IN ({_listed(values)})')


def downgrade() -> None:
    """Downgrade schema."""
    for table, column, _ in reversed(CHECKS):
        op.drop_constraint(f'ck_{table}_{column}', table, type_='check')
    for table, column, target in reversed(RESTRICT):
        name = f'{table}_{column}_fkey'
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, target, [column], ['id'])
    for table, column in reversed(INDEXES):
        op.drop_index(f'ix_{table}_{column}', table_name=table)
