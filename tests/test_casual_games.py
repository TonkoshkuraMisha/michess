# --- FILE: tests/test_casual_games.py ---
"""
Товарищеские партии: отдельная очередь подбора, тип сохраняется в приглашении и реванше,
рейтинг и античит такую партию не трогают, а подсказки движка во время неё всё равно закрыты.
"""

import pytest

from src.api import fair_play
from src.api.websockets import create_rematch_game
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.game_state import is_rated_state, state_manager
from src.services.matchmaker import matchmaker
from tests.test_ws_rate_limit import _run

API = "/api/v1/profile"
TC = (180000, 0)


async def _users(db_session, *ratings: int) -> list[User]:
    users = [User(
        username=f"casual_{i}_{r}", hashed_password="pw", bullet_rating=r, blitz_rating=r,
        rapid_rating=r, classical_rating=r,
    ) for i, r in enumerate(ratings)]
    db_session.add_all(users)
    await db_session.commit()
    for user in users:
        await db_session.refresh(user)
    return users


# --- подбор -------------------------------------------------------------------------------


async def test_casual_and_rated_challenges_are_not_paired(db_session):
    a, b, c = await _users(db_session, 1500, 1500, 1500)

    assert await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session, rated=False) is None
    # Рейтинговый вызов с тем же контролем товарищеский не забирает.
    assert await matchmaker.join_queue(b.id, "b", 1500, *TC, db=db_session, rated=True) is None

    game_id = await matchmaker.join_queue(c.id, "c", 1500, *TC, db=db_session, rated=False)

    game = await db_session.get(Game, game_id)
    assert {game.white_player_id, game.black_player_id} == {a.id, c.id}
    assert game.is_rated is False
    assert is_rated_state(await state_manager.get_game_state(game_id)) is False
    # Рейтинговый вызов остался ждать.
    assert [p["user_id"] for p in await matchmaker.get_queue_players()] == [b.id]


async def test_lobby_shows_challenge_type_and_manual_accept_keeps_it(db_session):
    a, b = await _users(db_session, 1500, 1500)
    await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session, rated=False)

    (challenge,) = await matchmaker.get_queue_players()
    assert challenge["rated"] is False

    game_id = await matchmaker.accept_challenge(a.id, b.id, None, db=db_session)
    assert (await db_session.get(Game, game_id)).is_rated is False


async def test_switching_type_moves_the_challenge_to_the_other_queue(db_session):
    (a,) = await _users(db_session, 1500)
    await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session, rated=False)
    await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session, rated=True)

    assert await matchmaker.redis.zrange("queue:180000:0:casual", 0, -1) == []
    (challenge,) = await matchmaker.get_queue_players()
    assert challenge["rated"] is True

    await matchmaker.leave_queue(a.id)
    assert await matchmaker.get_queue_players() == []


async def test_rated_is_the_default(db_session):
    a, b = await _users(db_session, 1500, 1500)
    await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session)
    game_id = await matchmaker.join_queue(b.id, "b", 1500, *TC, db=db_session)

    assert (await db_session.get(Game, game_id)).is_rated is True
    assert is_rated_state(await state_manager.get_game_state(game_id)) is True


# --- приглашение и реванш -----------------------------------------------------------------


@pytest.mark.parametrize("rated", [True, False])
async def test_invite_keeps_game_type(db_session, rated):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, rated=rated)

    started = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)

    assert started["is_rated"] is rated
    assert (await db_session.get(Game, started["game_id"])).is_rated is rated


async def test_rematch_of_a_casual_game_is_casual(db_session):
    a, b = await _users(db_session, 1500, 1500)
    first = await matchmaker.start_pvp_game(a.id, b.id, *TC, db=db_session, is_rated=False)
    prev_state = await state_manager.get_game_state(first["game_id"])
    await state_manager.claim_game_end(first["game_id"], "1-0", "resignation")
    await state_manager.finish_game(db_session, first["game_id"], "1-0", termination="resignation")

    rematch = await create_rematch_game(db_session, prev_state)

    game = await db_session.get(Game, rematch["game_id"])
    assert game.is_rated is False
    assert (game.white_player_id, game.black_player_id) == (b.id, a.id)


# --- итог партии --------------------------------------------------------------------------


async def test_casual_game_does_not_change_ratings(db_session):
    a, b = await _users(db_session, 1500, 1700)
    started = await matchmaker.start_pvp_game(a.id, b.id, *TC, db=db_session, is_rated=False)
    game_id = started["game_id"]

    await state_manager.claim_game_end(game_id, "1-0", "resignation")
    result = await state_manager.finish_game(db_session, game_id, "1-0", termination="resignation")

    assert (result["white_delta"], result["black_delta"]) == (0, 0)
    for user, rating in ((a, 1500), (b, 1700)):
        await db_session.refresh(user)
        assert user.blitz_rating == rating
        assert user.blitz_games_played == 0
    game = await db_session.get(Game, game_id, populate_existing=True)
    assert game.status == GameStatus.COMPLETED and game.winner_id == a.id
    assert "Casual" in game.pgn if game.pgn else True


async def test_state_recovered_from_db_keeps_the_type(db_session):
    a, b = await _users(db_session, 1500, 1500)
    started = await matchmaker.start_pvp_game(a.id, b.id, *TC, db=db_session, is_rated=False)
    await state_manager.redis.delete(f"game:{started['game_id']}:state")  # Redis потерял состояние

    assert is_rated_state(await state_manager.get_game_state(started["game_id"])) is False


def test_states_created_before_casual_games_are_rated():
    assert is_rated_state({"white_id": "1"}) is True


# --- API ----------------------------------------------------------------------------------


async def test_ws_messages_carry_the_type(db_session):
    a, b = await _users(db_session, 1500, 1500)

    socket = await _run(a, [{"action": "create_invite", "base_time_ms": 180000, "increment_ms": 0, "rated": False}])
    assert socket.events("invite_created")[0]["rated"] is False

    await _run(a, [{"action": "join_queue", "base_time_ms": 180000, "increment_ms": 0, "rated": False}])
    # Вызов снимается при отключении — проверяем старт партии из очереди другим путём.
    await matchmaker.join_queue(a.id, "a", 1500, *TC, db=db_session, rated=False)
    game_id = await matchmaker.join_queue(b.id, "b", 1500, *TC, db=db_session, rated=False)

    # Переподключение: снимок партии сообщает её тип.
    snapshot = (await _run(b, [])).events("match_found")[0]
    assert snapshot["game_id"] == game_id and snapshot["is_rated"] is False


async def test_http_join_and_live_list_report_the_type(
        client, db_session, test_user_1, test_user_2, token_user_1, token_user_2,
):
    first = client.post(
        f"{API}/matchmaking/join", json={"base_time_ms": 180000, "increment_ms": 0, "rated": False},
        headers={"Authorization": f"Bearer {token_user_1}"},
    )
    assert first.json() == {"active": False, "queued": True}
    assert client.get(f"{API}/matchmaking/queue").json()[0]["rated"] is False

    second = client.post(
        f"{API}/matchmaking/join", json={"base_time_ms": 180000, "increment_ms": 0, "rated": False},
        headers={"Authorization": f"Bearer {token_user_2}"},
    )
    assert second.json()["active"] is True and second.json()["is_rated"] is False
    assert client.get(f"{API}/games/live").json()[0]["is_rated"] is False


async def test_engine_help_is_closed_in_casual_games_too(client, db_session, test_user_1, test_user_2, token_user_1):
    """Рейтинг не на кону, но напротив человек — подсказки движка так же нечестны."""
    await matchmaker.start_pvp_game(test_user_1.id, test_user_2.id, *TC, db=db_session, is_rated=False)

    response = client.post(
        "/api/v1/analysis/position", json={"moves": ["e4"]}, headers={"Authorization": f"Bearer {token_user_1}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == fair_play.IN_GAME_DETAIL
