import asyncio
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from fastapi.testclient import TestClient

from src.main import app
from src.db.session import get_db
from src.models.base import Base
from src.models.user import User
from src.core.security import create_access_token

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False, future=True)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
async def setup_database():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


class MockPubSub:
    """Заглушка для Redis Pub/Sub, чтобы фоновый таск не падал."""

    async def subscribe(self, *args, **kwargs):
        pass

    async def unsubscribe(self, *args, **kwargs):
        pass

    async def listen(self):
        while True:
            await asyncio.sleep(3600)


class MockAsyncRedis:
    """Высокопроизводительный асинхронный мок Redis в оперативной памяти для тестов."""

    def __init__(self):
        self.store = {}
        self.sets = {}
        self.lists = {}
        self.kv = {}
        self.zsets = {}

    def pubsub(self):
        return MockPubSub()

    async def hset(self, name, mapping=None, **kwargs):
        if name not in self.store:
            self.store[name] = {}
        if mapping:
            self.store[name].update({str(k): str(v) for k, v in mapping.items()})
        if kwargs:
            self.store[name].update({str(k): str(v) for k, v in kwargs.items()})
        return len(mapping or {}) + len(kwargs)

    async def hgetall(self, name):
        return self.store.get(name, {})

    async def delete(self, *names):
        count = 0
        for name in names:
            for container in (self.store, self.sets, self.lists, self.kv, self.zsets):
                if name in container:
                    del container[name]
                    count += 1
        return count

    async def sadd(self, name, *values):
        if name not in self.sets:
            self.sets[name] = set()
        added = 0
        for v in values:
            if str(v) not in self.sets[name]:
                self.sets[name].add(str(v))
                added += 1
        return added

    async def srem(self, name, *values):
        if name not in self.sets:
            return 0
        removed = 0
        for v in values:
            if str(v) in self.sets[name]:
                self.sets[name].remove(str(v))
                removed += 1
        return removed

    async def smembers(self, name):
        return self.sets.get(name, set())

    async def set(self, name, value):
        self.kv[name] = str(value)
        return True

    async def get(self, name):
        return self.kv.get(name)

    async def rpush(self, name, *values):
        if name not in self.lists:
            self.lists[name] = []
        for v in values:
            self.lists[name].append(v)
        return len(self.lists[name])

    async def lrange(self, name, start, end):
        lst = self.lists.get(name, [])
        if end == -1:
            return lst[start:]
        return lst[start:end + 1]

    # --- Поддержка Sorted Sets для очередей матчмейкинга ---
    async def zadd(self, name, mapping):
        if name not in self.zsets:
            self.zsets[name] = {}
        added = 0
        for k, v in mapping.items():
            if k not in self.zsets[name] or self.zsets[name][k] != float(v):
                added += 1
            self.zsets[name][k] = float(v)
        return added

    async def zrange(self, name, start, end):
        if name not in self.zsets:
            return []
        sorted_items = sorted(self.zsets[name].items(), key=lambda x: x[1])
        keys = [k for k, v in sorted_items]
        if end == -1:
            return keys[start:]
        return keys[start:end + 1]

    async def zrem(self, name, *values):
        if name not in self.zsets:
            return 0
        removed = 0
        for v in values:
            if v in self.zsets[name]:
                del self.zsets[name][v]
                removed += 1
        return removed


@pytest.fixture(autouse=True)
def override_redis(monkeypatch):
    mock_redis = MockAsyncRedis()

    # 1. Подменяем глобальные переменные в модулях
    monkeypatch.setattr("src.services.game_state.redis_client", mock_redis)
    monkeypatch.setattr("src.services.connection_manager.redis_client", mock_redis)
    monkeypatch.setattr("src.db.redis.redis_client", mock_redis)

    # 2. Подменяем ссылки внутри уже созданных синглтонов
    from src.services.game_state import state_manager
    from src.services.connection_manager import manager
    # Для Matchmaker
    from src.services.matchmaker import matchmaker

    monkeypatch.setattr(state_manager, "redis", mock_redis)
    monkeypatch.setattr(manager, "redis", mock_redis)
    monkeypatch.setattr(manager, "pubsub", mock_redis.pubsub())
    # Если Matchmaker использует redis как свойство:
    # monkeypatch.setattr(matchmaker, "redis", mock_redis) - не обязательно, если он достает его из db.redis


async def override_get_db():
    async with TestSessionLocal() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
async def test_user_1(db_session):
    user = User(username="player1", email="player1@example.com", hashed_password="fakehash", rating=1200)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_user_2(db_session):
    user = User(username="player2", email="player2@example.com", hashed_password="fakehash", rating=1200)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def token_user_1(test_user_1):
    return create_access_token({"sub": test_user_1.username})


@pytest.fixture
def token_user_2(test_user_2):
    return create_access_token({"sub": test_user_2.username})