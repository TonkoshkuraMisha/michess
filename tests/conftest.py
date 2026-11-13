# --- FILE: tests/conftest.py ---

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.security import create_user_token
from src.db.session import get_db, get_session_factory
from src.main import app
from src.models.base import Base
from src.models.user import User

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
        while True:  # noqa: ASYNC110 — заглушка «вечной» подписки, ждать нечего
            await asyncio.sleep(3600)


class MockPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        pass

    async def watch(self, *names):
        pass

    async def unwatch(self):
        pass

    def multi(self):
        self.commands = []

    def hset(self, name, key=None, value=None, mapping=None):
        self.commands.append(("hset", name, key, value, mapping))

    def sadd(self, name, *values):
        self.commands.append(("sadd", name, values))

    def expire(self, name, time):
        self.commands.append(("expire", name, time))

    def zadd(self, name, mapping):
        self.commands.append(("zadd", name, mapping))

    def zrem(self, name, *values):
        self.commands.append(("zrem", name, values))

    async def execute(self):
        for cmd in self.commands:
            if cmd[0] == "hset":
                mapping = dict(cmd[4] or {})
                if cmd[2] is not None:
                    mapping[cmd[2]] = cmd[3]
                await self.redis.hset(cmd[1], mapping=mapping)
            elif cmd[0] == "sadd":
                await self.redis.sadd(cmd[1], *cmd[2])
            elif cmd[0] == "zadd":
                await self.redis.zadd(cmd[1], cmd[2])
            elif cmd[0] == "zrem":
                await self.redis.zrem(cmd[1], *cmd[2])
        self.commands = []

    async def sismember(self, name, value):
        return str(value) in self.redis.sets.get(name, set())

    async def hgetall(self, name):
        return await self.redis.hgetall(name)


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

    def pipeline(self, transaction=True):
        return MockPipeline(self)

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

    async def sismember(self, name, value):
        return str(value) in self.sets.get(name, set())

    async def set(self, name, value, ex=None, px=None, nx=False):
        if nx and name in self.kv:
            return None
        self.kv[name] = str(value)
        return True

    async def pexpire(self, name, time):
        return name in self.kv

    async def expire(self, name, time):
        return any(name in c for c in (self.store, self.sets, self.lists, self.kv, self.zsets))

    async def publish(self, channel, message):
        self.published = getattr(self, "published", [])
        self.published.append((channel, message))
        return 0

    async def zcard(self, name):
        return len(self.zsets.get(name, {}))

    async def zremrangebyscore(self, name, min_score, max_score):
        zset = self.zsets.get(name, {})
        doomed = [k for k, v in zset.items() if float(min_score) <= v <= float(max_score)]
        for k in doomed:
            del zset[k]
        return len(doomed)

    async def get(self, name):
        return self.kv.get(name)

    async def ping(self):
        return True

    async def getdel(self, name):
        return self.kv.pop(name, None)

    async def incr(self, name, amount=1):
        value = int(self.kv.get(name, 0)) + amount
        self.kv[name] = str(value)
        return value

    async def rpush(self, name, *values):
        if name not in self.lists:
            self.lists[name] = []
        for v in values:
            self.lists[name].append(v)
        return len(self.lists[name])

    async def lpush(self, name, *values):
        lst = self.lists.setdefault(name, [])
        for v in values:
            lst.insert(0, v)
        return len(lst)

    async def ltrim(self, name, start, end):
        lst = self.lists.get(name, [])
        self.lists[name] = lst[start:] if end == -1 else lst[start:end + 1]
        return True

    async def lrange(self, name, start, end):
        lst = self.lists.get(name, [])
        if end == -1:
            return lst[start:]
        return lst[start:end + 1]

    async def zadd(self, name, mapping, nx=False):
        if name not in self.zsets:
            self.zsets[name] = {}
        added = 0
        for k, v in mapping.items():
            k = str(k)
            if nx and k in self.zsets[name]:
                continue
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

    async def zrangebyscore(self, name, min_score, max_score):
        zset = self.zsets.get(name, {})
        items = sorted((v, k) for k, v in zset.items() if float(min_score) <= v <= float(max_score))
        return [k for _, k in items]

    async def zscore(self, name, value):
        return self.zsets.get(name, {}).get(str(value))

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

    monkeypatch.setattr("src.services.game_state.redis_client", mock_redis)
    monkeypatch.setattr("src.services.connection_manager.redis_client", mock_redis)
    monkeypatch.setattr("src.db.redis.redis_client", mock_redis)

    from src.services.connection_manager import manager
    from src.services.game_state import state_manager

    monkeypatch.setattr(state_manager, "redis", mock_redis)
    monkeypatch.setattr(manager, "redis", mock_redis)
    monkeypatch.setattr(manager, "pubsub", mock_redis.pubsub())


@pytest.fixture(autouse=True)
def service_sessions_use_test_db(monkeypatch):
    """
    Сервисы, которые сами открывают сессию (восстановление состояния партии из БД, цикл таймаутов,
    матчмейкер без переданной сессии), берут фабрику из своего модуля, а не через зависимости
    FastAPI. Без подмены они ходили бы в базу из .env — тесты читали бы настоящую базу разработчика
    и зависели от её содержимого.
    """
    monkeypatch.setattr("src.services.game_state.AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr("src.services.matchmaker.AsyncSessionLocal", TestSessionLocal)


@pytest.fixture(autouse=True)
def no_celery_publish(monkeypatch):
    """Тесты не публикуют задачи в брокер: список опубликованных id партий — для проверок."""
    from src.services import task_dispatch

    published: list[int] = []
    monkeypatch.setattr(task_dispatch, "_publish_analysis", published.append)
    task_dispatch.reset_broker_cooldown()
    yield published
    task_dispatch.reset_broker_cooldown()


@pytest.fixture
def freeze_rate_limit_window(monkeypatch):
    """
    Фиксирует время для расчёта окна в rate_limit.py (кратно RATE_LIMIT_WINDOW_S от начала
    эпохи): несколько запросов подряд в тесте должны попасть в одно и то же окно независимо от
    реальной скорости выполнения — иначе тест изредка падает, если окно сменится между запросами.
    """
    from src.api import rate_limit as rate_limit_module

    monkeypatch.setattr(rate_limit_module.time, "time", lambda: 1_700_000_000.0)


async def override_get_db():
    async with TestSessionLocal() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_session_factory] = lambda: TestSessionLocal


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
async def test_user_1(db_session):
    user = User(
        username="player1", hashed_password="fakehash", bullet_rating=1200,
        blitz_rating=1200, rapid_rating=1200, classical_rating=1200
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_user_2(db_session):
    user = User(
        username="player2", hashed_password="fakehash", bullet_rating=1200,
        blitz_rating=1200, rapid_rating=1200, classical_rating=1200
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def token_user_1(test_user_1):
    return create_user_token(test_user_1)


@pytest.fixture
def token_user_2(test_user_2):
    return create_user_token(test_user_2)
