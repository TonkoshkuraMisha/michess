"""
Базовый класс моделей SQLAlchemy: от него наследуются все таблицы (src/models/*.py).
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Base class for all SQLAlchemy declarative models.
    """
    pass
