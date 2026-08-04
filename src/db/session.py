from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from src.core.config import settings

# Create asynchronous engine using configuration URL
engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    future=True,
)

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
    """
    async with AsyncSessionLocal() as session:
        yield session