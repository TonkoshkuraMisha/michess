from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """
    Application core settings configuration.
    Uses Pydantic for environment variable validation.
    """
    PROJECT_NAME: str = "Michess API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"

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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # Anti-Cheat Thresholds (скрываем точные цифры от лишних глаз)
    AC_BLUR_RATE_HIGH: float = 0.8
    AC_BLUR_RATE_MED: float = 0.5
    AC_MIN_MOVE_TIME_MS: int = 3000
    AC_MAX_MOVE_TIME_MS: int = 8000
    AC_STOCKFISH_PATH: str = "bin/stockfish-windows-x86-64-avx2.exe"  # Путь к бинарнику
    AC_MAX_CENTIPAWN_LOSS: int = 15  # Если средняя потеря меньше 15 - играет как киборг

    @property
    def async_database_url(self) -> str:
        """Assembles the database connection string for asyncpg."""
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )

settings = Settings()