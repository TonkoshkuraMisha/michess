# --- FILE: tests/test_account.py ---
"""Учётная запись (таски 17.5, 23.1): выгрузка своих данных и удаление аккаунта с анонимизацией."""

from sqlalchemy import func, select

from src.core.security import get_password_hash
from src.models.game import Game, GameStatus
from src.models.personality import BotPersonality
from src.models.user import User

API = "/api/v1/account"
PASSWORD = "secret-pass-1"


async def with_password(db_session, user: User) -> None:
    user.hashed_password = get_password_hash(PASSWORD)
    await db_session.commit()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def me(client, token):
    return client.get("/api/v1/profile/me", headers=auth(token)).json()


def test_export_contains_profile_games_and_personalities(client, token_user_1):
    client.post("/api/v1/bots/personalities", headers=auth(token_user_1),
                json={"name": "Gambit", "config": {}})
    response = client.get(f"{API}/export", headers=auth(token_user_1))
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    data = response.json()
    assert data["format"] == 1 and data["profile"]["username"] == me(client, token_user_1)["username"]
    assert [p["name"] for p in data["personalities"]] == ["Gambit"]
    for key in ("games", "lessons", "puzzle_themes", "puzzle_attempts", "personal_puzzles", "tournaments"):
        assert isinstance(data[key], list)


def test_export_requires_login(client):
    assert client.get(f"{API}/export").status_code == 401


async def test_delete_anonymises_and_wipes_personal_data(client, db_session, test_user_1, token_user_1, token_user_2):
    await with_password(db_session, test_user_1)
    profile = me(client, token_user_1)
    user_id, name = profile["id"], profile["username"]
    other = me(client, token_user_2)["id"]
    client.post("/api/v1/bots/personalities", headers=auth(token_user_1), json={"name": "Gambit", "config": {}})
    db_session.add(Game(white_player_id=user_id, black_player_id=other, status=GameStatus.COMPLETED, result="1-0"))
    await db_session.commit()

    wrong = client.post(f"{API}/delete", headers=auth(token_user_1), json={"password": "nope-nope"})
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "wrong_current_password"

    assert client.post(f"{API}/delete", headers=auth(token_user_1), json={"password": PASSWORD}).status_code == 204

    db_session.expire_all()
    user = await db_session.get(User, user_id)
    assert user.username == f"deleted_{user_id}" and user.deleted_at is not None and user.email is None
    assert await db_session.scalar(select(func.count(BotPersonality.id)).where(BotPersonality.owner_id == user_id)) == 0
    # Партия осталась у соперника.
    assert await db_session.scalar(select(func.count(Game.id)).where(Game.white_player_id == user_id)) == 1
    # Старый токен больше не действует, старое имя не входит и не открывает профиль.
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).status_code == 401
    login = client.post("/api/v1/auth/login", data={"username": name, "password": PASSWORD})
    assert login.status_code in (400, 401)
    assert client.get(f"/api/v1/profile/deleted_{user_id}").status_code == 404
    board = client.get("/api/v1/profile/leaderboard").json()
    assert all(row["username"] != f"deleted_{user_id}" for row in board)


async def test_cannot_delete_during_a_game(client, db_session, test_user_1, token_user_1, token_user_2):
    await with_password(db_session, test_user_1)
    user_id, other = me(client, token_user_1)["id"], me(client, token_user_2)["id"]
    db_session.add(Game(white_player_id=user_id, black_player_id=other, status=GameStatus.IN_PROGRESS))
    await db_session.commit()
    response = client.post(f"{API}/delete", headers=auth(token_user_1), json={"password": PASSWORD})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "account_in_game"
