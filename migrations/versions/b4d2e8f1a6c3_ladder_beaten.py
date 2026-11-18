"""club ladder by beaten opponents (owner's plan 18.11, task 7): ladder_beaten instead of users.ladder_step

Revision ID: b4d2e8f1a6c3
Revises: c9a4e7d2f5b8
Create Date: 2026-11-18 12:00:00.000000

Ступень игрока была индексом в списке соперников, поэтому новых соперников нельзя было вставить в лестницу, не
сдвинув прогресс. Теперь хранится множество пройденных ступеней (ключей соперников). Перенос: по прежнему
users.ladder_step игроку проставляются пройденными первые ladder_step ступеней прежнего списка — он заморожен ниже
(OLD_RUNGS: 17 ступеней в порядке, в котором их видели игроки до 18.11.2026). Откат возвращает номер ступени:
сколько ступеней прежнего списка пройдено подряд с начала.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b4d2e8f1a6c3'
down_revision: str | Sequence[str] | None = 'c9a4e7d2f5b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Лестница до 18.11.2026 (ladder.rungs() до этой миграции): десять архетипов мастерской и семь исторических
# ботов по измеренной силе.
OLD_RUNGS = (
    'archetype:rusher', 'archetype:quiet', 'archetype:pawn_keeper', 'archetype:cavalier', 'archetype:centralist',
    'archetype:fortress', 'archetype:adventurer', 'archetype:strategist', 'labourdonnais', 'philidor',
    'archetype:hunter', 'staunton', 'paulsen', 'zukertort', 'anderssen', 'morphy', 'archetype:combinator',
)


def upgrade() -> None:
    """Upgrade schema and carry the progress over."""
    op.create_table(
        'ladder_beaten',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('rung_key', sa.String(length=48), nullable=False),
        sa.Column('beaten_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'rung_key'),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.text('SELECT id, ladder_step FROM users WHERE ladder_step > 0')).all()
    beaten = [{'user_id': user_id, 'rung_key': key} for user_id, step in rows for key in OLD_RUNGS[:step]]
    if beaten:
        bind.execute(sa.text('INSERT INTO ladder_beaten (user_id, rung_key) VALUES (:user_id, :rung_key)'), beaten)
    op.drop_column('users', 'ladder_step')


def downgrade() -> None:
    """Downgrade schema: the step is the run of beaten opponents from the start of the old list."""
    op.add_column('users', sa.Column('ladder_step', sa.Integer(), server_default='0', nullable=False))
    bind = op.get_bind()
    rows = bind.execute(sa.text('SELECT user_id, rung_key FROM ladder_beaten')).all()
    beaten: dict[int, set[str]] = {}
    for user_id, key in rows:
        beaten.setdefault(user_id, set()).add(key)
    for user_id, keys in beaten.items():
        step = 0
        while step < len(OLD_RUNGS) - 1 and OLD_RUNGS[step] in keys:
            step += 1
        bind.execute(sa.text('UPDATE users SET ladder_step = :step WHERE id = :id'), {'step': step, 'id': user_id})
    op.drop_table('ladder_beaten')
