"""
Подключение к PostgreSQL: асинхронный движок SQLAlchemy и фабрика сессий.

Адрес базы собирается из настроек POSTGRES_* (settings.async_database_url), размер пула — DB_POOL_SIZE и
DB_MAX_OVERFLOW на каждый процесс API. Два способа получить сессию:

* get_db — зависимость FastAPI для HTTP-запроса: сессия живёт до конца запроса;
* get_session_factory — фабрика для долгих соединений (WebSocket): обработчик открывает короткую сессию на одно
  действие, иначе соединение пула было бы занято всё время, пока открыта вкладка игрока.

Фоновые задачи Celery создают свой движок на каждую задачу (src/worker/tasks.py).
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings
from src.core.observability import instrument_engine

# Движок — один на процесс API. pool_timeout — сколько запрос ждёт свободное соединение (DB_POOL_TIMEOUT_S);
# pool_pre_ping проверяет соединение перед выдачей, чтобы после перезапуска PostgreSQL запросы не падали на
# оборванных соединениях. instrument_engine считает занятые соединения для метрики regence_db_pool_checked_out.
engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    future=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT_S,
    pool_pre_ping=True,
)
instrument_engine(engine)

# Фабрика сессий. expire_on_commit=False: объекты остаются читаемыми после commit — обработчики WebSocket
# освобождают соединение до отправки ответа и продолжают пользоваться уже загруженными данными.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


async def get_db():
    """
    Зависимость FastAPI: сессия базы на один HTTP-запрос, закрывается после ответа. Сама ничего не коммитит —
    изменения сохраняет обработчик или сервис.

    Только для HTTP-запросов: сессия живёт до конца запроса. Долгоживущим обработчикам
    (WebSocket) нужна фабрика get_session_factory и короткая сессия на каждую операцию.
    """
    async with AsyncSessionLocal() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """
    Зависимость FastAPI: фабрика сессий для долгоживущих соединений.

    Сессия из get_db, взятая WebSocket-обработчиком, жила бы всё соединение: первый же запрос
    открывает транзакцию, и соединение пула остаётся занятым («idle in transaction»), пока
    игрок подключён. Поэтому WebSocket открывает по короткой сессии на каждое действие.
    """
    return AsyncSessionLocal
