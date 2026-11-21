"""
Формат регистрации и ответа с данными игрока, правила имени.

Имя: от USERNAME_MIN_LENGTH до USERNAME_MAX_LENGTH знаков, только буквы латиницы или кириллицы, цифры, «_» и
«-»; смешивать алфавиты нельзя (иначе «Мorphy» с кириллической М выглядел бы как чужое имя). Сравнение имён без
учёта регистра — username_key. Зарезервированные имена (маршруты, боты, чемпионы) проверяет src/api/auth.py.
"""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.core.errors import validation_error
from src.services.onboarding import Experience, StrengthBand

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 30
_USERNAME_RE = re.compile(r"[A-Za-z0-9А-Яа-яЁё_-]+")
_LATIN_RE = re.compile(r"[A-Za-z]")
_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")


def username_key(username: str) -> str:
    """Ключ для сравнения имён без учёта регистра (casefold); хранится в users.username_key и уникален в базе."""
    return username.strip().casefold()


def validate_username(value: str) -> str:
    """
    Правила имени при регистрации. Белый список символов отсекает пробелы, невидимые и
    управляющие символы, а запрет смешивать алфавиты — подделки вида «Мorphy» (кириллическая М).
    Имя должно содержать хотя бы одну букву. Нарушение — ошибка проверки с кодом из src/core/errors.py
    (username_invalid_chars, username_mixed_scripts, username_no_letters). Те же правила — у имён соперников
    мастерской (src/api/personalities.py).
    """
    if not _USERNAME_RE.fullmatch(value):
        raise validation_error("username_invalid_chars")
    if _LATIN_RE.search(value) and _CYRILLIC_RE.search(value):
        raise validation_error("username_mixed_scripts")
    if not any(ch.isalpha() for ch in value):
        raise validation_error("username_no_letters")
    return value


# Длина пароля (регистрация, смена и сброс — src/api/auth.py, src/api/account.py): не короче 8 знаков; верхняя
# граница — чтобы не хэшировать мегабайтные «пароли» (bcrypt всё равно учитывает 72 байта). Клиент проверяет
# нижнюю заранее — frontend/src/config/passwordRules.ts.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


class UserCreate(BaseModel):
    """Данные регистрации (POST /auth/register): имя, пароль и необязательные ответы и код-приглашение."""
    username: str = Field(
        ..., min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH, description="Unique username",
    )
    password: str = Field(..., min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH, description="Strong password")
    # Первый вход (таск 17.8): необязательные ответы для стартового рейтинга (src/services/onboarding.py).
    experience: Experience | None = None
    strength: StrengthBand | None = None
    # Код-приглашение (таск 24.4): обязателен при закрытой регистрации (REGISTRATION_INVITE_ONLY).
    invite_code: str | None = Field(None, max_length=64)
    # Согласие с условиями (таск 23.1): обязательно при REQUIRE_TERMS_CONSENT, иначе 400 terms_not_accepted.
    accept_terms: bool = False

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return validate_username(value)


class UserResponse(BaseModel):
    """
    Ответ регистрации — данные только что созданного игрока. Хэша пароля и числового фактора доверия
    (users.trust_factor) в нём нет; флаг is_cheater игрок о себе видит.
    """
    id: int
    username: str
    bullet_rating: int
    blitz_rating: int
    rapid_rating: int
    classical_rating: int
    is_cheater: bool
    created_at: datetime

    # from_attributes: ответ собирается прямо из объекта модели User.
    model_config = ConfigDict(from_attributes=True)
