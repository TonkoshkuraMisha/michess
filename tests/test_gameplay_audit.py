# --- FILE: tests/test_gameplay_audit.py ---
"""
Сценарии, на которых доска клиента расходилась с сервером: отклонённый ход без позиции в ответе,
сбой БД после уже принятого хода, потерянный game_over, просмотр чужой партии во время своей.
"""

import pytest

from src.api import websockets as ws_module
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.connection_manager import manager
from src.services.game_state import pending_draw_offer, state_manager
from src.services.matchmaker import matchmaker
from tests.test_ws_rate_limit import _run, _user

API = "/api/v1"


@pytest.fixture
async def game():
    await state_manager.initialize_game(game_id=91, white_id=911, black_id=912, base_time_ms=60000, increment_ms=0)
    return 91


async def _players(db, *names: str) -> list[User]:
    users = [
        User(username=name, hashed_password="x", bullet_rating=1500, blitz_rating=1500,
             rapid_rating=1500, classical_rating=1500)
        for name in names
    ]
    db.add_all(users)
    await db.commit()
    for user in users:
        await db.refresh(user)
    return users


# --- отклонённый ход возвращает позицию --------------------------------------------------


@pytest.mark.parametrize(("user_id", "move"), [(912, "e7e5"), (911, "e2e5")])
async def test_rejected_move_returns_current_position(game, user_id, move):
    """Чужая очередь хода и нелегальный ход: клиент уже нарисовал ход и должен получить позицию назад."""
    await _run(_user(911), [{"action": "make_move", "game_id": game, "move": "e2e4", "state_version": 0}])
    if user_id == 912:
        await _run(_user(912), [{"action": "make_move", "game_id": game, "move": "e7e5", "state_version": 1}])
        mover, version = 912, 2
    else:
        await _run(_user(912), [{"action": "make_move", "game_id": game, "move": "d7d5", "state_version": 1}])
        mover, version = 911, 2
        move = "e4e6"  # нелегальный ход пешкой

    socket = await _run(_user(mover), [{"action": "make_move", "game_id": game, "move": move}])
    if mover == 912:
        # 912 только что сходил — сейчас очередь белых.
        assert socket.events("error")[0]["message"] == "not_your_turn"
    else:
        assert socket.events("error")[0]["message"] == "illegal_move"
    error = socket.events("error")[0]
    assert error["state_version"] == version
    assert error["fen"] and "e4" in error["pgn"]


async def test_outsider_does_not_get_position_in_rejection(game):
    socket = await _run(_user(999), [{"action": "make_move", "game_id": game, "move": "e2e4"}])
    error = socket.events("error")[0]
    assert error["message"] == "not_your_turn"
    assert error["fen"] is None and error["pgn"] is None


# --- сбой после принятого хода не срывает рассылку -----------------------------------------


async def test_move_is_broadcast_even_if_db_sync_fails(game, monkeypatch):
    async def broken_sync(*args, **kwargs):
        raise RuntimeError("database is down")

    monkeypatch.setattr(state_manager, "sync_authoritative_state_to_db", broken_sync)
    socket = await _run(_user(911), [{
        "action": "make_move", "game_id": game, "move": "e2e4", "state_version": 0, "time_taken_ms": None,
    }])

    assert len(socket.events("move_made")) == 1
    assert not socket.events("error")
    assert (await state_manager.get_game_state(game))["state_version"] == 1


@pytest.mark.parametrize("message", [
    {"action": "make_move", "game_id": "abc", "move": "e2e4"},
    {"action": "make_move", "game_id": 91, "move": ["e2e4"]},
    {"action": "join_queue", "base_time_ms": "fast"},
    {"action": "accept_challenge", "target_user_id": "nobody"},
    {"action": "leave_spectate", "game_id": {"id": 1}},
])
async def test_malformed_fields_are_ignored_not_internal_errors(game, message):
    socket = await _run(_user(911), [message])
    assert not [e for e in socket.events("error") if "Internal" in e.get("message", "")]


async def test_garbage_state_version_is_treated_as_missing(game):
    socket = await _run(_user(911), [{"action": "make_move", "game_id": game, "move": "e2e4", "state_version": "x"}])
    assert len(socket.events("move_made")) == 1


# --- предложение ничьей -------------------------------------------------------------------


async def test_draw_offer_survives_reconnect_snapshot(game):
    await _run(_user(911), [
        {"action": "make_move", "game_id": game, "move": "e2e4", "state_version": 0},
        {"action": "offer_draw", "game_id": game},
    ])
    assert pending_draw_offer(await state_manager.get_game_state(game)) == 911

    # Соперник переподключается: снимок партии сообщает о действующем предложении.
    socket = await _run(_user(912), [])
    snapshot = socket.events("match_found")[0]
    assert snapshot["draw_offer_from"] == 911
    assert snapshot["opponent_id"] == 911


async def test_draw_offer_after_game_end_does_not_recreate_state(game):
    await state_manager.claim_game_end(game, "1-0", "resignation")
    await state_manager.clear_game_state(game)

    await _run(_user(911), [{"action": "offer_draw", "game_id": game}])
    # Либо состояния нет, либо оно целиком восстановлено из БД — но не «огрызок» из одного поля.
    state = await state_manager.redis.hgetall(f"game:{game}:state")
    assert not state.get("draw_offer")
    assert state == {} or "white_id" in state


async def test_decline_without_offer_is_ignored(game):
    socket = await _run(_user(912), [{"action": "decline_draw", "game_id": game}])
    assert not socket.sent or not socket.events("draw_declined")
    # Свой собственный оффер «отклонить» тоже нельзя.
    await _run(_user(911), [{"action": "offer_draw", "game_id": game}])
    await _run(_user(911), [{"action": "decline_draw", "game_id": game}])
    assert pending_draw_offer(await state_manager.get_game_state(game)) == 911


# --- зрители ------------------------------------------------------------------------------


async def test_starting_a_game_stops_spectating(db_session, game):
    white, black = await _players(db_session, "spec_white", "spec_black")
    await manager.add_spectator(game, white.id)
    assert white.id in await manager.get_spectator_ids(game)

    await matchmaker.start_pvp_game(white.id, black.id, 180000, 0, db=db_session)

    assert white.id not in await manager.get_spectator_ids(game)


async def test_spectate_of_finished_game_has_error_code():
    socket = await _run(_user(950), [{"action": "spectate_game", "game_id": 424242}])
    assert socket.sent == [] or all(e.get("code") == "spectate_unavailable" for e in socket.events("error"))


def test_flood_close_code_differs_from_session_revoked():
    """1008 клиент понимает как отозванную сессию и разлогинивает — флуд так закрывать нельзя."""
    assert ws_module.WS_CLOSE_FLOOD != ws_module.WS_CLOSE_POLICY_VIOLATION


# --- итог партии по HTTP ------------------------------------------------------------------


async def test_game_summary_reports_result(client, db_session):
    white, black = await _players(db_session, "sum_white", "sum_black")
    finished = Game(
        white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED,
        result="0-1", termination="resignation", white_rating_delta=-8, black_rating_delta=8,
    )
    running = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.IN_PROGRESS)
    db_session.add_all([finished, running])
    await db_session.commit()

    body = client.get(f"{API}/profile/games/{finished.id}/summary").json()
    assert body == {
        "game_id": finished.id, "status": "COMPLETED", "result": "0-1", "termination": "resignation",
        "white_delta": -8, "black_delta": 8,
    }
    assert client.get(f"{API}/profile/games/{running.id}/summary").json()["status"] == "IN_PROGRESS"
    assert client.get(f"{API}/profile/games/999999/summary").status_code == 404


# --- боты ---------------------------------------------------------------------------------


@pytest.mark.parametrize("fen", [
    "8/8/8/8/8/8/8/8 w - - 0 1",        # нет королей
    "kK6/8/8/8/8/8/8/8 w - - 0 1",      # короли рядом
])
def test_bot_move_rejects_impossible_position(client, fen):
    response = client.post(f"{API}/bots/move", json={"bot_id": "philidor", "fen": fen})
    assert response.status_code == 400


def test_bot_game_with_absurd_time_control_is_rejected(client, token_user_1):
    response = client.post(
        f"{API}/bots/save-game",
        headers={"Authorization": f"Bearer {token_user_1}"},
        json={"bot_id": "philidor", "player_color": "white", "result": "1-0",
              "moves_uci": ["e2e4"], "base_time_ms": 10**12},
    )
    assert response.status_code == 422
