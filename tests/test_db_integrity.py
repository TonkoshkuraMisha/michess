# --- FILE: tests/test_db_integrity.py ---
"""
Целостность схемы (ревизия базы 29.1, задача 3 плана 18.11):
- у каждой ссылки (внешнего ключа) есть индекс, начинающийся с неё, и явное правило удаления;
- наборы значений CHECK в моделях совпадают с наборами, которые проверяют сервисы (один источник правды на деле);
- база отказывает в записи значения вне набора (SQLite в тестах соблюдает CHECK так же, как PostgreSQL).
"""

from typing import get_args

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

import src.models  # noqa: F401 — регистрирует все таблицы
from src.models import beta as beta_models
from src.models import imported_game, library, moderation, puzzle, tournament
from src.models import user as user_models
from src.models.base import Base
from src.models.user import User
from src.services import beta, defense_drills, direct_messages, game_import, tournament_rules, tournaments
from src.services import library as library_service
from src.services import moderation as moderation_service


def _leading_columns(table: sa.Table) -> set[str]:
    """Колонки, с которых начинается какой-либо индекс, первичный ключ или ограничение уникальности."""
    leading = {col.name for col in table.columns if col.index or col.unique}
    leading |= {list(idx.columns)[0].name for idx in table.indexes if list(idx.columns)}
    for cons in table.constraints:
        cols = list(getattr(cons, "columns", []))
        if cols and isinstance(cons, (sa.PrimaryKeyConstraint, sa.UniqueConstraint)):
            leading.add(cols[0].name)
    return leading


def test_every_foreign_key_is_indexed_and_has_a_delete_rule():
    missing_index, missing_rule = [], []
    for table in Base.metadata.tables.values():
        leading = _leading_columns(table)
        for col in table.columns:
            for fk in col.foreign_keys:
                if col.name not in leading:
                    missing_index.append(f"{table.name}.{col.name}")
                if fk.ondelete is None:
                    missing_rule.append(f"{table.name}.{col.name}")
    assert missing_index == [] and missing_rule == []


@pytest.mark.parametrize(("model_values", "service_values"), [
    (beta_models.FEEDBACK_STATUSES, beta.FEEDBACK_STATUSES),
    (puzzle.DEFENSE_DRILL_KINDS, defense_drills.KINDS),
    (library.LIBRARY_RESULTS, library_service.RESULTS),
    (library.ANNOTATION_STATUSES, library_service.ANNOTATION_STATUSES),
    (moderation.REPORT_ACTIONS, moderation_service.ACTIONS),
    (moderation.REPORT_REASONS, (*moderation_service.REASONS, "auto")),
    (user_models.DM_POLICIES, direct_messages.POLICIES),
    (imported_game.IMPORT_SOURCES, (*game_import.SOURCES, "pgn")),
    (tournament.TOURNAMENT_STAGES, get_args(tournament_rules.Stage)),
    (tournament.TOURNAMENT_RESULTS, get_args(tournament_rules.Result)),
    (tournament.TOURNAMENT_FORMATS, get_args(tournaments.Format)),
])
def test_check_sets_match_the_services(model_values, service_values):
    assert set(model_values) == set(service_values)


async def test_the_database_refuses_a_value_outside_the_set(db_session):
    db_session.add(User(username="integrity_probe", hashed_password="pw", dm_policy="everyone"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
