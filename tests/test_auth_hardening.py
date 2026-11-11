# --- FILE: tests/test_auth_hardening.py ---
"""
Вход и регистрация: лимиты попыток (подбор пароля), правила имени пользователя,
уникальность и вход без учёта регистра, зарезервированные имена.
"""

import pytest
from sqlalchemy import select

from src.api import auth as auth_module
from src.core.config import settings
from src.models.user import User

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
PASSWORD = "secret123"


def _register(client, username: str, password: str = PASSWORD):
    return client.post(REGISTER, json={"username": username, "password": password})


def _login(client, username: str, password: str = PASSWORD):
    return client.post(LOGIN, data={"username": username, "password": password})


# --- Имя пользователя ----------------------------------------------------------------------

def test_register_response_hides_trust_factor(client):
    res = _register(client, "Misha")
    assert res.status_code == 201
    body = res.json()
    assert body["username"] == "Misha"
    assert "trust_factor" not in body


@pytest.mark.parametrize("name", [
    "ab",                  # короче 3 символов
    "a" * 31,              # длиннее 30
    "Misha K",             # пробел
    " Misha",              # пробел по краю
    "Мorphy",              # кириллическая «М» + латиница — подделка под бота/игрока
    "misha​",         # невидимый символ
    "misha!",
    "12345",               # без единой буквы
    "--__--",
])
def test_invalid_usernames_are_rejected(client, name):
    assert _register(client, name).status_code == 422


@pytest.mark.parametrize("name", ["Misha_K", "misha-2006", "Пётр", "ёжик_1"])
def test_valid_usernames_are_accepted(client, name):
    assert _register(client, name).status_code == 201


# («me» короче трёх символов — его отсекает уже правило длины.)
@pytest.mark.parametrize("name", ["games", "Leaderboard", "ADMIN", "morphy", "Steinitz", "Capablanca"])
def test_reserved_usernames_are_rejected(client, name):
    res = _register(client, name)
    assert res.status_code == 400
    assert "зарезервировано" in res.json()["detail"]


@pytest.mark.parametrize("first, second", [("Misha", "misha"), ("Пётр", "пётр"), ("ёжик", "ЁЖИК")])
def test_usernames_are_unique_regardless_of_case(client, first, second):
    assert _register(client, first).status_code == 201
    res = _register(client, second)
    assert res.status_code == 400
    assert res.json()["detail"] == auth_module.DUPLICATE_USERNAME_DETAIL


async def test_registered_user_gets_username_key(client, db_session):
    assert _register(client, "Пётр").status_code == 201
    user = (await db_session.execute(select(User).where(User.username == "Пётр"))).scalars().one()
    assert user.username_key == "пётр"


# --- Вход ----------------------------------------------------------------------------------

def test_login_is_case_insensitive_and_opens_the_canonical_account(client):
    assert _register(client, "Misha").status_code == 201
    res = _login(client, "mISHA")
    assert res.status_code == 200
    me = client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {res.json()['access_token']}"})
    assert me.json()["username"] == "Misha"


def test_unknown_user_still_runs_password_check(client, monkeypatch):
    """Ответ для несуществующего аккаунта не должен быть быстрее: по времени узнали бы, есть ли он."""
    checked: list[str] = []

    def spy_verify(plain, hashed):
        checked.append(hashed)
        return False

    monkeypatch.setattr(auth_module, "verify_password", spy_verify)
    assert _login(client, "nobody_here").status_code == 401
    assert checked == [auth_module._DUMMY_PASSWORD_HASH]


def test_failed_logins_lock_the_account_temporarily(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT", 3)
    assert _register(client, "victim").status_code == 201
    assert _register(client, "bystander").status_code == 201

    for _ in range(3):
        assert _login(client, "victim", "wrong-password").status_code == 401

    # Даже верный пароль не проверяется, пока не истечёт окно: подбор остановлен.
    locked = _login(client, "VICTIM")
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0

    assert _login(client, "bystander").status_code == 200  # другие аккаунты не затронуты


def test_successful_logins_do_not_count_as_failures(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT", 2)
    assert _register(client, "regular").status_code == 201
    for _ in range(5):
        assert _login(client, "regular").status_code == 200


def test_login_attempts_are_limited_per_ip(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_PER_IP", 3)
    for i in range(3):
        assert _login(client, f"spray_{i}", "guess").status_code == 401
    assert _login(client, "spray_4", "guess").status_code == 429


def test_registrations_are_limited_per_ip(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_REGISTER_PER_IP", 2)
    assert _register(client, "first_one").status_code == 201
    assert _register(client, "second_one").status_code == 201
    assert _register(client, "third_one").status_code == 429
