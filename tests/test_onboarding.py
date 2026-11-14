# --- FILE: tests/test_onboarding.py ---
"""Первый вход (таск 17.8): стартовый рейтинг по ответам при регистрации и пометка временного рейтинга."""

import pytest
from sqlalchemy import select

from src.models.user import User
from src.services.onboarding import starting_rating

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
PASSWORD = "secret123"


@pytest.mark.parametrize("experience, strength, expected", [
    ("new", None, 600),
    ("new", "over_1800", 600),  # «только узнал правила» сильнее оценки силы
    ("casual", None, 1000),
    ("regular", None, 1200),
    ("casual", "1400_1800", 1550),
    (None, "under_1000", 800),
    (None, "over_1800", 1850),
    (None, None, 1200),
])
def test_starting_rating(experience, strength, expected):
    assert starting_rating(experience, strength) == expected


async def _user(db_session, name: str) -> User:
    return (await db_session.execute(select(User).where(User.username == name))).scalars().one()


async def test_answers_set_game_and_puzzle_ratings(client, db_session):
    res = client.post(REGISTER, json={"username": "Novice", "password": PASSWORD, "experience": "new"})
    assert res.status_code == 201
    user = await _user(db_session, "Novice")
    assert (user.bullet_rating, user.blitz_rating, user.rapid_rating, user.classical_rating) == (600,) * 4
    assert user.puzzle_rating == 600


async def test_without_answers_defaults_stay(client, db_session):
    assert client.post(REGISTER, json={"username": "Silent", "password": PASSWORD}).status_code == 201
    user = await _user(db_session, "Silent")
    assert user.blitz_rating == 1200 and user.puzzle_rating == 1500


def test_unknown_answer_is_rejected(client):
    res = client.post(REGISTER, json={"username": "Odd", "password": PASSWORD, "strength": "grandmaster"})
    assert res.status_code == 422


def test_new_account_rating_is_provisional(client):
    client.post(REGISTER, json={"username": "Fresh", "password": PASSWORD, "strength": "1000_1400"})
    token = client.post(LOGIN, data={"username": "Fresh", "password": PASSWORD}).json()["access_token"]
    me = client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["blitz_rating"] == 1200
    assert me["provisional"] == ["bullet", "blitz", "rapid", "classical"]
