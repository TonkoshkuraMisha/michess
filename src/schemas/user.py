import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 30
_USERNAME_RE = re.compile(r"[A-Za-z0-9А-Яа-яЁё_-]+")
_LATIN_RE = re.compile(r"[A-Za-z]")
_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")


def username_key(username: str) -> str:
    """Ключ для сравнения имён без учёта регистра."""
    return username.strip().casefold()


def validate_username(value: str) -> str:
    """
    Правила имени при регистрации. Белый список символов отсекает пробелы, невидимые и
    управляющие символы, а запрет смешивать алфавиты — подделки вида «Мorphy» (кириллическая М).
    """
    if not _USERNAME_RE.fullmatch(value):
        raise ValueError("Имя может содержать только буквы (латиница или кириллица), цифры, «_» и «-»")
    if _LATIN_RE.search(value) and _CYRILLIC_RE.search(value):
        raise ValueError("Имя не может смешивать латиницу и кириллицу")
    if not any(ch.isalpha() for ch in value):
        raise ValueError("Имя должно содержать хотя бы одну букву")
    return value


class UserCreate(BaseModel):
    """Schema for incoming user registration data."""
    username: str = Field(
        ..., min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH, description="Unique username",
    )
    # Верхняя граница — чтобы не хэшировать мегабайтные «пароли»; bcrypt всё равно учитывает 72 байта.
    password: str = Field(..., min_length=8, max_length=128, description="Strong password")

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return validate_username(value)


class UserResponse(BaseModel):
    """Schema for outgoing user data (password and anti-cheat internals excluded)."""
    id: int
    username: str
    rating: int
    is_cheater: bool
    created_at: datetime

    # This config allows Pydantic to read data directly from SQLAlchemy models
    model_config = ConfigDict(from_attributes=True)
