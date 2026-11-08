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
