# --- FILE: tests/test_fair_play.py ---
"""
Честная игра: оценка позиции и ход бота недоступны, пока у игрока идёт рейтинговая партия, —
ни с его токеном, ни без токена с его адреса. Чужой аккаунт с того же адреса не блокируется,
но оставляет сигнал античиту.
"""

import pytest

from src.api import fair_play
from src.core.config import settings
from src.db import redis as redis_module
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.services.anticheat import evaluate_game_telemetry
from src.services.game_state import state_manager

POSITION_URL = "/api/v1/analysis/position"
BOT_MOVE_URL = "/api/v1/bots/move"
START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
TEST_CLIENT_IP = "testclient"  # адрес, под которым TestClient виден серверу


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def rated_game(test_user_1, test_user_2):
    await state_manager.initialize_game(
        game_id=501, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    return 501


async def test_player_in_rated_game_gets_no_position_analysis(client, rated_game, token_user_1):
    response = client.post(POSITION_URL, json={"moves": ["e4"]}, headers=_auth(token_user_1))

    assert response.status_code == 409
    assert response.json()["detail"] == fair_play.IN_GAME_DETAIL


async def test_player_in_rated_game_cannot_ask_a_bot_for_a_move(client, rated_game, token_user_2):
    response = client.post(
        BOT_MOVE_URL, json={"bot_id": "philidor", "fen": START_FEN}, headers=_auth(token_user_2),
    )
    assert response.status_code == 409


async def test_analysis_is_available_again_after_the_game(client, rated_game, token_user_1):
    await state_manager.claim_game_end(rated_game, "1-0", "resignation")
    await state_manager.clear_game_state(rated_game)

    response = client.post(POSITION_URL, json={"moves": ["e4"]}, headers=_auth(token_user_1))
    assert response.status_code == 200


async def test_user_without_a_game_is_not_affected(client, token_user_1):
    assert client.post(POSITION_URL, json={"moves": []}, headers=_auth(token_user_1)).status_code == 200


async def test_dropping_the_token_does_not_bypass_the_ban(client, rated_game, test_user_1):
    """Игрок подключён с адреса X — запрос без токена с адреса X во время его партии отклоняется."""
    await fair_play.remember_player_ip(test_user_1.id, TEST_CLIENT_IP)

    response = client.post(POSITION_URL, json={"moves": ["e4"]})

    assert response.status_code == 409
    assert response.json()["detail"] == fair_play.GUEST_IN_GAME_DETAIL


async def test_guest_from_an_idle_address_is_allowed(client, test_user_1):
    await fair_play.remember_player_ip(test_user_1.id, TEST_CLIENT_IP)  # игрок есть, партии нет
    assert client.post(POSITION_URL, json={"moves": []}).status_code == 200


async def test_other_account_on_the_same_address_is_allowed_but_recorded(
        client, db_session, rated_game, test_user_1, test_user_2, token_user_1,
):
    """Третий игрок в той же сети пользуется анализом — ему не мешаем, но играющему ставим отметку."""
    from src.core.security import create_user_token
    from src.models.user import User

    bystander = User(
        username="bystander", hashed_password="x", bullet_rating=1500, blitz_rating=1500,
        rapid_rating=1500, classical_rating=1500,
    )
    db_session.add(bystander)
    await db_session.commit()
    await db_session.refresh(bystander)
    await fair_play.remember_player_ip(test_user_1.id, TEST_CLIENT_IP)

    for _ in range(2):
        response = client.post(POSITION_URL, json={"moves": []}, headers=_auth(create_user_token(bystander)))
        assert response.status_code == 200

    assert await fair_play.engine_requests_during_game(rated_game, test_user_1.id) == 2
    assert await fair_play.engine_requests_during_game(rated_game, test_user_2.id) == 0


async def test_signal_is_reported_by_anticheat_without_penalty(db_session, test_user_1, test_user_2):
    game = Game(
        white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED,
        result="1-0", is_rated=True,
    )
    db_session.add(game)
    await db_session.commit()
    db_session.add_all([
        Move(game_id=game.id, player_id=test_user_1.id, move_number=1, notation="e2e4", san="e4",
             fen_after="", time_taken_ms=900, window_blurred_before_move=False, is_premove=False, network_lag_ms=0),
        Move(game_id=game.id, player_id=test_user_2.id, move_number=1, notation="e7e5", san="e5",
             fen_after="", time_taken_ms=1100, window_blurred_before_move=False, is_premove=False, network_lag_ms=0),
    ])
    await db_session.commit()
    await redis_module.redis_client.incr(f"fairplay:engine_requests:{game.id}:{test_user_1.id}")

    report = await evaluate_game_telemetry(db_session, game.id)

    assert report[test_user_1.id]["engine_requests_same_ip"] == 1
    assert report[test_user_2.id]["engine_requests_same_ip"] == 0
    assert report[test_user_1.id]["trust_factor"] == 100  # сигнал сам по себе не штрафует


async def test_guests_have_a_stricter_rate_limit(client, monkeypatch, token_user_1, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_POSITION_ANALYSIS", 5)
    monkeypatch.setattr(settings, "RATE_LIMIT_POSITION_ANALYSIS_GUEST", 1)

    assert client.post(POSITION_URL, json={"moves": []}).status_code == 200
    assert client.post(POSITION_URL, json={"moves": []}).status_code == 429
    # У вошедшего пользователя свой, более щедрый лимит.
    codes = [client.post(POSITION_URL, json={"moves": []}, headers=_auth(token_user_1)).status_code for _ in range(5)]
    assert codes == [200] * 5


async def test_check_fails_open_when_redis_is_down(client, monkeypatch, token_user_1):
    async def broken(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(fair_play, "active_rated_game_id", broken)
    assert client.post(POSITION_URL, json={"moves": []}, headers=_auth(token_user_1)).status_code == 200


async def test_websocket_connection_remembers_the_player_address(test_user_1):
    from tests.test_ws_rate_limit import _CLOSE, QueueSocket, _NoDbSession, matchmaking_endpoint

    class Client:
        host = "203.0.113.7"

    socket = QueueSocket()
    socket.client = Client()
    socket.incoming.put_nowait(_CLOSE)
    await matchmaking_endpoint(socket, test_user_1, _NoDbSession)

    members = await redis_module.redis_client.smembers("fairplay:ip:203.0.113.7")
    assert str(test_user_1.id) in members
