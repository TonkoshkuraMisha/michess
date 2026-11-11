from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings
from src.core.observability import instrument_engine

# Create asynchronous engine using configuration URL
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

# Create asynchronous session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


async def get_db():
    """
    Dependency generator that yields an asynchronous database session.
    Ensures proper cleanup after request completion.

    Только для HTTP-запросов: сессия живёт до конца запроса. Долгоживущим обработчикам
    (WebSocket) нужна фабрика get_session_factory и короткая сессия на каждую операцию.
    """
    async with AsyncSessionLocal() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """
    Dependency: фабрика сессий для долгоживущих соединений.

    Сессия из get_db, взятая WebSocket-обработчиком, жила бы всё соединение: первый же запрос
    открывает транзакцию, и соединение пула остаётся занятым («idle in transaction»), пока
    игрок подключён. Поэтому WebSocket открывает по короткой сессии на каждое действие.
    """
    return AsyncSessionLocal
