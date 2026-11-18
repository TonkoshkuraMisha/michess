# --- FILE: tests/integration/conftest.py ---
"""
Общие фикстуры интеграционных тестов на настоящем PostgreSQL: пустая схема из моделей на каждый тест и фабрика
сессий без пула соединений (у каждой конкурирующей сессии — своё соединение, иначе гонки не настоящие).
Адрес базы — переменная TEST_DATABASE_URL (в CI её задаёт .github/workflows/ci.yml); без неё тесты модулей
пропускаются их собственной отметкой skipif.
"""

import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.models.base import Base

DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture
async def pg():
    """Фабрика сессий настоящей базы; схема создаётся заново перед тестом и удаляется после."""
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()
