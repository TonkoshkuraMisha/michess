# --- FILE: tests/test_matchmaking_rules.py ---
"""
Матчмейкинг: свежий рейтинг из БД, диапазон рейтинга, запрет второй партии одновременно.
"""

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.core.config import settings
from src.models.game import Game
from src.models.user import User
from src.services.game_state import state_manager
from src.services.matchmaker import MatchmakingError, matchmaker


async def _users(db_session, *ratings: int) -> list[User]:
    users = [User(username=f"mm_{i}_{r}", hashed_password="pw", rating=r) for i, r in enumerate(ratings)]
    db_session.add_all(users)
    await db_session.commit()
    return users


async def _in_queue(uid: int) -> bool:
    return bool(await matchmaker.redis.hgetall(f"queue:prefs:{uid}"))


# --- Свежий рейтинг ---------------------------------------------------------------------

async def test_stale_session_sees_fresh_rating(db_session):
    """Долгоживущая WS-сессия держит старый объект пользователя; рейтинг перечитывается из БД."""
    from src.api.websockets import _fresh_current_user

    (user,) = await _users(db_session, 1500)

    other = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with other() as session:
        (await session.get(User, user.id)).rating = 1700
        await session.commit()

    assert user.rating == 1500  # объект в identity map WS-сессии устарел
    assert (await _fresh_current_user(db_session, user)).rating == 1700


async def test_game_record_uses_fresh_ratings(db_session):
    white, black = await _users(db_session, 1500, 1600)
    other = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with other() as session:
        (await session.get(User, white.id)).rating = 1555
        await session.commit()

    started = await matchmaker.start_pvp_game(white.id, black.id, 180000, 0, db=db_session)

    game = await db_session.get(Game, started["game_id"])
    assert started["white_rating"] == 1555
    assert game.white_initial_rating == 1555


# --- Диапазон рейтинга ------------------------------------------------------------------

async def test_auto_match_respects_both_rating_windows(db_session):
    a, b, c = await _users(db_session, 1200, 1800, 1250)

    assert await matchmaker.join_queue(a.id, "a", 1200, 180000, 0, 1100, 1300, db=db_session) is None
    # b без ограничений, но a его не принимает (1800 вне 1100–1300).
    assert await matchmaker.join_queue(b.id, "b", 1800, 180000, 0, db=db_session) is None
    assert await _in_queue(a.id) and await _in_queue(b.id)

    game_id = await matchmaker.join_queue(c.id, "c", 1250, 180000, 0, 1000, 1500, db=db_session)
    assert game_id is not None
    state = await state_manager.get_game_state(game_id)
    assert {int(state["white_id"]), int(state["black_id"])} == {a.id, c.id}
    assert await _in_queue(b.id)


async def test_auto_match_prefers_closest_rating(db_session):
    a, d, e = await _users(db_session, 1200, 1400, 1380)
    # a и d друг другу не подходят (d не принимает 1200), а e (1380) подходит обоим.
    await matchmaker.join_queue(a.id, "a", 1200, 180000, 0, 1100, 1400, db=db_session)
    assert await matchmaker.join_queue(d.id, "d", 1400, 180000, 0, 1350, 1450, db=db_session) is None

    game_id = await matchmaker.join_queue(e.id, "e", 1380, 180000, 0, db=db_session)

    state = await state_manager.get_game_state(game_id)
    assert {int(state["white_id"]), int(state["black_id"])} == {d.id, e.id}


async def test_manual_accept_outside_challenge_range_is_rejected(db_session):
    a, b = await _users(db_session, 1200, 1900)
    await matchmaker.join_queue(a.id, "a", 1200, 180000, 0, 1100, 1300, db=db_session)

    with pytest.raises(MatchmakingError) as err:
        await matchmaker.accept_challenge(a.id, b.id, None, db=db_session)

    assert err.value.code == "rating_out_of_range"
    assert await _in_queue(a.id)  # вызов остался в лобби


async def test_default_rating_window_from_settings(db_session, monkeypatch):
    monkeypatch.setattr(settings, "MATCHMAKING_DEFAULT_RATING_RANGE", 100)
    (a,) = await _users(db_session, 1500)

    await matchmaker.join_queue(a.id, "a", 1500, 180000, 0, db=db_session)

    prefs = await matchmaker.redis.hgetall(f"queue:prefs:{a.id}")
    assert (int(prefs["min_rating"]), int(prefs["max_rating"])) == (1400, 1600)


async def test_invalid_time_control_is_rejected(db_session):
    (a,) = await _users(db_session, 1500)
    with pytest.raises(MatchmakingError) as err:
        await matchmaker.join_queue(a.id, "a", 1500, -5, 0, db=db_session)
    assert err.value.code == "invalid_time_control"


# --- Уже в партии -----------------------------------------------------------------------

async def test_player_in_game_cannot_join_or_accept(db_session):
    a, b, c = await _users(db_session, 1500, 1500, 1500)
    await matchmaker.start_pvp_game(a.id, b.id, 180000, 0, db=db_session)
    await matchmaker.join_queue(c.id, "c", 1500, 180000, 0, db=db_session)

    with pytest.raises(MatchmakingError) as join_err:
        await matchmaker.join_queue(a.id, "a", 1500, 180000, 0, db=db_session)
    with pytest.raises(MatchmakingError) as accept_err:
        await matchmaker.accept_challenge(c.id, a.id, None, db=db_session)

    assert join_err.value.code == "self_in_game"
    assert accept_err.value.code == "self_in_game"
    assert await _in_queue(c.id)


async def test_challenge_of_busy_player_is_removed(db_session):
    a, b, c = await _users(db_session, 1500, 1500, 1500)
    await matchmaker.join_queue(a.id, "a", 1500, 180000, 0, db=db_session)
    # a начал партию по приглашению, а его вызов остался бы в лобби.
    await state_manager.initialize_game(4242, a.id, b.id, 180000, 0)

    with pytest.raises(MatchmakingError) as err:
        await matchmaker.accept_challenge(a.id, c.id, None, db=db_session)

    assert err.value.code == "opponent_in_game"
    assert not await _in_queue(a.id)


async def test_starting_game_removes_both_players_from_lobby(db_session):
    a, b = await _users(db_session, 1500, 1500)
    await matchmaker.join_queue(a.id, "a", 1500, 300000, 0, db=db_session)  # другой контроль — не сведутся
    await matchmaker.join_queue(b.id, "b", 1500, 180000, 0, db=db_session)

    await matchmaker.start_pvp_game(a.id, b.id, 600000, 0, db=db_session)

    assert not await _in_queue(a.id) and not await _in_queue(b.id)


async def test_invite_is_kept_when_creator_is_busy(db_session):
    creator, acceptor, other = await _users(db_session, 1500, 1500, 1500)
    invite = await matchmaker.create_private_invite(creator.id, "creator", 1500, 180000, 0)
    await state_manager.initialize_game(4343, creator.id, other.id, 180000, 0)

    with pytest.raises(MatchmakingError) as err:
        await matchmaker.start_game_from_invite(invite["code"], acceptor.id, db=db_session)

    assert err.value.code == "opponent_in_game"
    assert await matchmaker.get_private_invite(invite["code"]) is not None


async def test_finished_game_does_not_block_new_one(db_session):
    a, b = await _users(db_session, 1500, 1500)
    await state_manager.initialize_game(4444, a.id, b.id, 180000, 0)
    await state_manager.update_game_state(4444, {"status": "completed"})

    started = await matchmaker.start_pvp_game(a.id, b.id, 180000, 0, db=db_session)
    assert started["game_id"]


async def test_http_join_while_in_game_returns_active_game(client, db_session, test_user_1, test_user_2, token_user_1):
    """Фронтенд шлёт join и по WS, и по HTTP: проигравший гонку HTTP-запрос отдаёт начатую партию."""
    started = await matchmaker.start_pvp_game(test_user_1.id, test_user_2.id, 180000, 0, db=db_session)

    res = client.post(
        "/api/v1/profile/matchmaking/join",
        json={"base_time_ms": 180000, "increment_ms": 0},
        headers={"Authorization": f"Bearer {token_user_1}"},
    )

    assert res.status_code == 200
    assert res.json()["game_id"] == started["game_id"]
