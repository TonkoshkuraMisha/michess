from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application core settings configuration.
    Uses Pydantic for environment variable validation.
    """
    PROJECT_NAME: str = "Michess API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"

    # PostgreSQL settings matching docker-compose.yml
    POSTGRES_USER: str = "michess_user"
    POSTGRES_PASSWORD: str = "michess_password"
    POSTGRES_SERVER: str = "127.0.0.1"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "michess_db"

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