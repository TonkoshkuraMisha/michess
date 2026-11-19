"""rename own puzzle source and theme tags: michess -> regence (platform rename, 19.11.2026)

Свои задачи (src/services/puzzle_import.py, GENERATED_SOURCE / OWN_TAG) хранились с источником «michess» и тегами
«michess:<код>» в puzzles.source_tags. Схема не меняется — только данные, чтобы повторный импорт и переразметка
узнавали уже загруженные задачи под новым именем.

Revision ID: d3a8f1c6e2b7
Revises: c7d2e9f4a1b6
Create Date: 2026-11-19 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd3a8f1c6e2b7'
down_revision: str | Sequence[str] | None = 'c7d2e9f4a1b6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Источник и теги своих задач — под новым именем платформы."""
    op.execute(
        "UPDATE puzzles SET source = 'regence', source_tags = REPLACE(source_tags, 'michess:', 'regence:') "
        "WHERE source = 'michess'"
    )


def downgrade() -> None:
    """Обратно к прежнему имени."""
    op.execute(
        "UPDATE puzzles SET source = 'michess', source_tags = REPLACE(source_tags, 'regence:', 'michess:') "
        "WHERE source = 'regence'"
    )
