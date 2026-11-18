"""
Базовый класс моделей SQLAlchemy: от него наследуются все таблицы (src/models/*.py).
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Общий предок всех моделей: в его metadata собираются таблицы, по которым Alembic строит миграции.
    """
    pass
