"""
Базовый класс моделей SQLAlchemy: от него наследуются все таблицы (src/models/*.py), и общий помощник one_of для
ограничений-перечислений.
"""

from collections.abc import Iterable

from sqlalchemy import CheckConstraint
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Общий предок всех моделей: в его metadata собираются таблицы, по которым Alembic строит миграции.
    """
    pass


def one_of(table: str, column: str, values: Iterable[str]) -> CheckConstraint:
    """
    Ограничение CHECK «значение колонки — одно из values» с именем ck_<таблица>_<колонка> (ревизия базы 29.1,
    находка 3): несуществующий статус не запишут ни ошибка в коде, ни ручная правка. NULL ограничение пропускает —
    обязательность задаёт nullable колонки. Набор значений — кортеж рядом с колонкой в модели; если такой же набор
    есть в сервисе, их равенство проверяет tests/test_db_integrity.py. Новое значение — правка кортежа и миграция
    (Alembic такие ограничения сам не находит — миграцию пишут вручную, по образцу 59c61fc287c2).
    """
    listed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{column} IN ({listed})", name=f"ck_{table}_{column}")
