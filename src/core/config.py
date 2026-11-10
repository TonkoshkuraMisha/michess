# --- FILE: src/core/config.py ---

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application core settings configuration.
    Uses Pydantic for environment variable validation.
    """
    PROJECT_NAME: str = "Michess API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]

    # PostgreSQL
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_SERVER: str
    POSTGRES_PORT: int
    POSTGRES_DB: str

    # Connection pool (per process)
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_S: float = 30.0

    # Redis
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379

    # Security (JWT)
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # Anti-Cheat Thresholds
    AC_BLUR_RATE_HIGH: float = 0.8
    AC_BLUR_RATE_MED: float = 0.5
    AC_MIN_MOVE_TIME_MS: int = 3000
    AC_MAX_MOVE_TIME_MS: int = 8000
    AC_STOCKFISH_PATH: str = "bin/stockfish-windows-x86-64-avx2.exe"
    AC_MAX_CENTIPAWN_LOSS: int = 15
    # A client-claimed premove is trusted only if the server saw the move arrive this fast
    AC_PREMOVE_MAX_ELAPSED_MS: int = 600

    # Matchmaking: rating window (±N) used when the client sends no explicit range; 0 = unrestricted
    MATCHMAKING_DEFAULT_RATING_RANGE: int = 0

    # Celery publishing from the API process: short timeouts, no publish retries, and a pause
    # after a broker failure so a dead broker cannot stall the event loop or pile up threads
    CELERY_PUBLISH_TIMEOUT_S: float = 3.0
    CELERY_BROKER_CONNECT_TIMEOUT_S: float = 1.0
    CELERY_BROKER_COOLDOWN_S: float = 30.0

    # Stockfish engine pool
    ENGINE_POOL_SIZE: int = 2
    ENGINE_ACQUIRE_TIMEOUT_S: float = 10.0

    # Rate limits for engine-backed endpoints (requests per window, per user or per IP for guests)
    RATE_LIMIT_WINDOW_S: int = 60
    RATE_LIMIT_BOT_MOVE: int = 90
    RATE_LIMIT_POSITION_ANALYSIS: int = 30
    RATE_LIMIT_GAME_ANALYSIS: int = 6

    @property
    def async_database_url(self) -> str:
        """Assembles the database connection string for asyncpg."""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
