from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application core settings configuration.
    Uses Pydantic for environment variable validation.
    """
    PROJECT_NAME: str = "Michess API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"

    # DB and Redis configs will be added here later

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )


settings = Settings()