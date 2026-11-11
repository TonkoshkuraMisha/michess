"""
REST API профиля: поиск игрока по имени, таблица лидеров, история партий с пагинацией и
сортировкой, PGN, активная и live-партии, HTTP-дубли действий лобби.
"""

from datetime import UTC, datetime

import pytest

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.game_state import state_manager

API = "/api/v1/profile"


def _user(username: str, *, key: bool = True, blitz: int = 1500, bullet: int = 1400, **extra) -> User:
    return User(
        username=username,
        username_key=username.casefold() if key else None,
        hashed_password="fakehash",
        bullet_rating=bullet, blitz_rating=blitz, rapid_rating=1600, classical_rating=1700,
        **extra,
    )


async def _add(db, *objs):
    db.add_all(objs)
    await db.commit()
    for obj in objs:
        await db.refresh(obj)
    return objs


def _game(white: User, black: User, **fields) -> Game:
    values = {
        "white_player_id": white.id, "black_player_id": black.id,
        "status": GameStatus.COMPLETED, "result": "1-0",
        "pgn": '[Event "Casual"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0',
        "base_time_ms": 180000, "increment_ms": 0,
        "finished_at": datetime(2026, 11, 1, tzinfo=UTC),
    }
    values.update(fields)
    return Game(**values)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- Поиск игрока по имени ----------------------------------------------------------------------

async def test_profile_by_exact_name_returns_all_category_ratings(client, db_session):
    await _add(db_session, _user("Alice"))

    res = client.get(f"{API}/Alice")

    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "Alice"
    assert (body["bullet_rating"], body["blitz_rating"], body["rapid_rating"], body["classical_rating"]) == (
        1400, 1500, 1600, 1700,
    )
    assert "trust_factor" not in body and "hashed_password" not in body


async def test_profile_lookup_ignores_case(client, db_session):
    await _add(db_session, _user("Alice"), _user("Steinitz, William", key=False, is_bot=True))

    assert client.get(f"{API}/alice").json()["username"] == "Alice"
    # Архивный игрок без username_key находится по имени без учёта регистра.
    assert client.get(f"{API}/steinitz, william").json()["username"] == "Steinitz, William"


@pytest.mark.parametrize("query", ["Ali", "lic", "%", "_____", "A%"])
async def test_partial_or_wildcard_name_is_not_found(client, db_session, query):
    """Раньше поиск по подстроке открывал профиль постороннего игрока по части имени."""
    await _add(db_session, _user("Alice"))

    assert client.get(f"{API}/{query}").status_code == 404
    assert client.get(f"{API}/{query}/games").status_code == 404


# --- Таблица лидеров ----------------------------------------------------------------------------

async def test_leaderboard_ranks_by_category_and_hides_bots_and_cheaters(client, db_session):
    await _add(
        db_session,
        _user("fast", bullet=2100, blitz=1300),
        _user("solid", bullet=1300, blitz=2000),
        _user("engine_bot", bullet=2900, blitz=2900, is_bot=True),
        _user("caught", bullet=2800, blitz=2800, is_cheater=True),
    )

    bullet = client.get(f"{API}/leaderboard", params={"category": "bullet"}).json()
    blitz = client.get(f"{API}/leaderboard").json()  # по умолчанию — блиц

    assert [(p["rank"], p["username"], p["rating"]) for p in bullet] == [(1, "fast", 2100), (2, "solid", 1300)]
    assert [p["username"] for p in blitz] == ["solid", "fast"]


async def test_leaderboard_respects_limit_and_validates_params(client, db_session):
    await _add(db_session, *[_user(f"p{i}", blitz=1500 + i) for i in range(5)])

    assert [p["username"] for p in client.get(f"{API}/leaderboard", params={"limit": 2}).json()] == ["p4", "p3"]
    assert client.get(f"{API}/leaderboard", params={"limit": 0}).status_code == 422
    assert client.get(f"{API}/leaderboard", params={"limit": 101}).status_code == 422
    assert client.get(f"{API}/leaderboard", params={"category": "hyperbullet"}).status_code == 422


# --- История партий ----------------------------------------------------------------------------

async def test_user_games_lists_only_completed_games_with_pgn(client, db_session):
    alice, bob = await _add(db_session, _user("alice"), _user("bob"))
    await _add(
        db_session,
        _game(alice, bob, pgn_date="2026.10.01"),
        _game(bob, alice, result="0-1", pgn_date="2026.10.02"),
        _game(alice, bob, status=GameStatus.IN_PROGRESS, result=None),
        _game(alice, bob, status=GameStatus.ABORTED, result=None),
        _game(alice, bob, pgn=None),
        _game(alice, bob, pgn=""),
    )

    body = client.get(f"{API}/alice/games").json()

    assert body["total"] == 2
    assert [item["pgn_date"] for item in body["items"]] == ["2026.10.02", "2026.10.01"]
    assert all(item["status"] == "COMPLETED" for item in body["items"])


async def test_user_games_rating_is_taken_from_the_game_category(client, db_session):
    alice, bob = await _add(db_session, _user("alice", bullet=1111, blitz=2222), _user("bob"))
    await _add(db_session, _game(alice, bob, base_time_ms=60000, pgn_date="2026.10.01"))  # пуля 1+0

    item = client.get(f"{API}/alice/games").json()["items"][0]

    assert item["white_username"] == "alice" and item["white_rating"] == 1111


async def test_user_games_pagination_and_sorting(client, db_session):
    alice, bob = await _add(db_session, _user("alice"), _user("bob"))
    dates = ["2026.01.05", "2026.03.01", "2026.02.10", "????.??.??"]
    await _add(db_session, *[_game(alice, bob, pgn_date=date) for date in dates])

    desc = client.get(f"{API}/alice/games", params={"limit": 2}).json()
    rest = client.get(f"{API}/alice/games", params={"limit": 2, "offset": 2}).json()
    asc = client.get(f"{API}/alice/games", params={"sort": "asc"}).json()

    assert desc["total"] == rest["total"] == 4
    # Партии с неизвестной датой — всегда в конце, в обоих направлениях.
    assert [i["pgn_date"] for i in desc["items"] + rest["items"]] == [
        "2026.03.01", "2026.02.10", "2026.01.05", "????.??.??",
    ]
    assert [i["pgn_date"] for i in asc["items"]] == ["2026.01.05", "2026.02.10", "2026.03.01", "????.??.??"]
    assert client.get(f"{API}/alice/games", params={"limit": 0}).status_code == 422
    assert client.get(f"{API}/alice/games", params={"offset": -1}).status_code == 422


async def test_user_games_fill_missing_metadata_from_pgn(client, db_session):
    alice, bob = await _add(db_session, _user("alice"), _user("bob"))
    pgn = (
        '[Event "Club"]\n[Site "Riga"]\n[Date "1960.04.12"]\n[Result "1/2-1/2"]\n[ECO "C42"]\n\n'
        "1. e4 e5 2. Nf3 Nf6 1/2-1/2"
    )
    await _add(db_session, _game(alice, bob, pgn=pgn, result="*", pgn_date=None, site=None, eco=None))

    item = client.get(f"{API}/alice/games").json()["items"][0]

    assert (item["result"], item["pgn_date"], item["site"], item["eco"]) == ("1/2-1/2", "1960.04.12", "Riga", "C42")


# --- PGN ----------------------------------------------------------------------------------------

async def test_download_pgn(client, db_session):
    alice, bob = await _add(db_session, _user("alice"), _user("bob"))
    (game,) = await _add(db_session, _game(alice, bob))

    res = client.get(f"{API}/games/{game.id}/pgn")

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-chess-pgn")
    assert f"michess_game_{game.id}.pgn" in res.headers["content-disposition"]
    assert "Qxf7#" in res.text
    assert client.get(f"{API}/games/999999/pgn").status_code == 404


# --- Активная и live-партии ---------------------------------------------------------------------

async def test_my_profile_requires_auth_and_hides_trust_factor(client, test_user_1, token_user_1):
    assert client.get(f"{API}/me").status_code == 401

    body = client.get(f"{API}/me", headers=_auth(token_user_1)).json()

    assert body["username"] == "player1"
    assert body["is_cheater"] is False
    assert "trust_factor" not in body


async def test_my_active_game_snapshot(client, test_user_1, test_user_2, token_user_1, token_user_2):
    assert client.get(f"{API}/games/my-active", headers=_auth(token_user_1)).json() == {"active": False}

    await state_manager.initialize_game(
        game_id=501, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=300000, increment_ms=3000,
    )
    await state_manager.redis.set(f"user:{test_user_1.id}:current_game", "501")
    await state_manager.redis.set(f"user:{test_user_2.id}:current_game", "501")

    white = client.get(f"{API}/games/my-active", headers=_auth(token_user_1)).json()
    black = client.get(f"{API}/games/my-active", headers=_auth(token_user_2)).json()

    assert white["active"] is True and white["game_id"] == 501
    assert (white["color"], black["color"]) == ("white", "black")
    assert white["opponent_id"] == test_user_2.id
    assert white["white_username"] == "player1" and white["black_username"] == "player2"
    assert white["base_time_ms"] == 300000 and white["increment_ms"] == 3000
    assert 0 < white["white_time_ms"] <= 300000 and white["black_time_ms"] == 300000


async def test_my_active_game_ignores_foreign_or_finished_game(client, test_user_1, token_user_1):
    await state_manager.initialize_game(game_id=502, white_id=7001, black_id=7002, base_time_ms=60000, increment_ms=0)
    await state_manager.redis.set(f"user:{test_user_1.id}:current_game", "502")

    assert client.get(f"{API}/games/my-active", headers=_auth(token_user_1)).json() == {"active": False}


async def test_live_games_list(client, db_session):
    alice, bob = await _add(db_session, _user("alice", bullet=1900), _user("bob", bullet=1800))
    assert client.get(f"{API}/games/live").json() == []

    await state_manager.initialize_game(game_id=601, white_id=alice.id, black_id=bob.id, base_time_ms=60000, increment_ms=0)
    await state_manager.initialize_game(game_id=602, white_id=bob.id, black_id=alice.id, base_time_ms=60000, increment_ms=0)
    await state_manager.redis.hset("game:602:state", mapping={"status": "completed"})
    await state_manager.redis.sadd("active_games", "not-a-number")

    live = client.get(f"{API}/games/live").json()

    assert [g["game_id"] for g in live] == [601]
    assert (live[0]["white_username"], live[0]["white_rating"]) == ("alice", 1900)  # пуля 1+0
    assert (live[0]["black_username"], live[0]["black_rating"]) == ("bob", 1800)
    assert live[0]["spectators_count"] == 0


# --- HTTP-дубли действий лобби ------------------------------------------------------------------

async def test_http_queue_join_list_and_leave(client, test_user_1, token_user_1):
    joined = client.post(
        f"{API}/matchmaking/join", headers=_auth(token_user_1), json={"base_time_ms": 300000, "increment_ms": 0},
    ).json()
    assert joined == {"active": False, "queued": True}

    queue = client.get(f"{API}/matchmaking/queue").json()
    assert [(p["username"], p["base_time_ms"]) for p in queue] == [("player1", 300000)]

    assert client.post(f"{API}/matchmaking/leave", headers=_auth(token_user_1)).json() == {"status": "left"}
    assert client.get(f"{API}/matchmaking/queue").json() == []


async def test_http_accept_own_or_missing_challenge(client, test_user_1, token_user_1):
    own = client.post(f"{API}/matchmaking/accept/{test_user_1.id}", headers=_auth(token_user_1))
    missing = client.post(f"{API}/matchmaking/accept/987654", headers=_auth(token_user_1))

    assert own.status_code == 400
    assert missing.status_code in (404, 409)
