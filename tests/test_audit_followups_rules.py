# --- FILE: tests/test_audit_followups_rules.py ---
"""
Правила, доделанные после аудита: итог партии с ботом определяет сервер, имена ботов
зарезервированы, чат — только для игроков, брошенная партия при недостатке материала — ничья.
"""

import time

import chess
import pytest

from src.api.bots import BotGameSaveRequest, resolve_bot_game_outcome
from src.core.security import verify_password
from src.services.game_state import ABANDON_TIMEOUT_MS, ABANDON_DRAW_TERMINATION, evaluate_clock_expiry

FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def _payload(**kwargs) -> BotGameSaveRequest:
    base = {"bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": ["e2e4"]}
    return BotGameSaveRequest(**{**base, **kwargs})


def _board(moves: list[str]) -> chess.Board:
    board = chess.Board()
    for mv in moves:
        board.push_uci(mv)
    return board


# --- Итог партии с ботом ----------------------------------------------------------------

def test_terminal_position_result_comes_from_board():
    """Клиент заявил победу белых, но на доске мат белым — сохраняется 0-1."""
    assert resolve_bot_game_outcome(_board(FOOLS_MATE), _payload(result="1-0")) == ("0-1", "checkmate")


def test_unfinished_position_win_without_reason_is_rejected():
    with pytest.raises(ValueError):
        resolve_bot_game_outcome(_board(["e2e4"]), _payload(result="1-0"))


def test_resignation_is_always_players_loss():
    assert resolve_bot_game_outcome(
        _board(["e2e4"]), _payload(result="1-0", termination="resignation", player_color="white"),
    ) == ("0-1", "resignation")


def test_timeout_follows_fide_insufficient_material():
    board = chess.Board("4q3/8/8/4k3/8/8/2N5/K7 b - - 0 60")  # у белых только конь против ферзя
    assert resolve_bot_game_outcome(board, _payload(result="1-0", termination="timeout")) == (
        "1/2-1/2", "timeout_vs_insufficient_material",
    )
    assert resolve_bot_game_outcome(_board(["e2e4"]), _payload(result="0-1", termination="timeout")) == (
        "0-1", "timeout",
    )


def test_save_game_endpoint_stores_server_result(client, token_user_1):
    res = client.post(
        "/api/v1/bots/save-game",
        json={"bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": FOOLS_MATE},
        headers={"Authorization": f"Bearer {token_user_1}"},
    )
    assert res.status_code == 200
    assert res.json()["result"] == "0-1"

    rejected = client.post(
        "/api/v1/bots/save-game",
        json={"bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": ["e2e4"]},
        headers={"Authorization": f"Bearer {token_user_1}"},
    )
    assert rejected.status_code == 400


# --- Имена ботов ------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["Пол Морфи", "  пол морфи ", "morphy", "Пол Чарльз Морфи"])
def test_bot_names_cannot_be_registered(client, name):
    res = client.post("/api/v1/auth/register", json={"username": name, "password": "secret123"})
    # 400 — имя бота; 422 — имя с пробелами не проходит правила имени ещё раньше.
    assert res.status_code in (400, 422)


async def test_bot_game_is_not_attributed_to_human_with_bot_name(client, db_session, token_user_1):
    from src.models.game import Game
    from src.models.user import User

    impostor = User(username="Пол Морфи", hashed_password="real-hash", rating=1500)
    db_session.add(impostor)
    await db_session.commit()

    res = client.post(
        "/api/v1/bots/save-game",
        json={"bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE},
        headers={"Authorization": f"Bearer {token_user_1}"},
    )
    game = await db_session.get(Game, res.json()["game_id"])
    assert impostor.id not in (game.white_player_id, game.black_player_id)


def test_bot_marker_password_never_verifies():
    assert verify_password("anything", "!historical_bot_no_login!") is False


# --- Брошенная партия -------------------------------------------------------------------

def test_abandon_vs_insufficient_material_is_draw():
    now = int(time.time() * 1000)
    state = {
        "white_id": 1, "black_id": 2, "turn": "black", "board_fen": "8/8/8/4k3/8/8/2q5/K7 b - - 0 60",
        "white_time_ms": 60000, "black_time_ms": 60000, "last_move_at": now,
        "white_disconnected": "false", "black_disconnected": "true",
        "black_disconnect_started_at": now - ABANDON_TIMEOUT_MS,
    }
    # Чёрные (с ферзём) ушли, у белых голый король — победу белым не засчитываем.
    assert evaluate_clock_expiry(state, now) == ("1/2-1/2", None, ABANDON_DRAW_TERMINATION)


# --- Чат --------------------------------------------------------------------------------

class _NoDbSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, *args, **kwargs):
        return None


def _ws_as(monkeypatch, user_id: int):
    from src.api.deps import get_current_user_ws
    from src.db.session import get_session_factory
    from src.main import app
    from src.models.user import User

    async def _user():
        return User(id=user_id, username=f"u{user_id}", rating=1500)


    monkeypatch.setitem(app.dependency_overrides, get_current_user_ws, _user)
    monkeypatch.setitem(app.dependency_overrides, get_session_factory, lambda: _NoDbSession)


def _receive_event(ws, event: str, attempts: int = 6) -> dict:
    for _ in range(attempts):
        message = ws.receive_json()
        if message.get("event") == event:
            return message
    raise AssertionError(f"event {event} not received")


async def test_only_players_can_write_to_game_chat(client, monkeypatch):
    from src.services.game_state import state_manager

    await state_manager.initialize_game(game_id=61, white_id=701, black_id=702, base_time_ms=60000, increment_ms=0)

    _ws_as(monkeypatch, 703)  # посторонний / зритель
    with client.websocket_connect("/api/v1/ws/matchmaking?ticket=unused") as ws:
        ws.send_json({"action": "chat_message", "game_id": 61, "text": "играй Фxf7!"})
        assert _receive_event(ws, "error")["code"] == "chat_forbidden"

    _ws_as(monkeypatch, 701)  # игрок
    with client.websocket_connect("/api/v1/ws/matchmaking?ticket=unused") as ws:
        ws.send_json({"action": "chat_message", "game_id": 61, "text": "удачи!"})
        assert _receive_event(ws, "chat_message")["text"] == "удачи!"


# --- Античит ----------------------------------------------------------------------------

class _FakeMove:
    def __init__(self, n: int, ms: int, blurred: bool, premove: bool = False):
        self.move_number, self.time_taken_ms = n, ms
        self.window_blurred_before_move, self.is_premove = blurred, premove


def test_blur_alone_does_not_penalize():
    """Второй монитор: фокус теряется постоянно, но ритм ходов человеческий — штрафа нет."""
    from src.services.anticheat import compute_telemetry_penalty

    human_times = [1200, 9500, 3100, 22000, 4800, 2600, 15000, 7000, 1800, 11000, 5200, 3900]
    moves = [_FakeMove(i + 1, t, blurred=True) for i, t in enumerate(human_times)]
    assert compute_telemetry_penalty(moves)["penalty"] == 0


def test_blur_aggravates_engine_like_timing():
    from src.services.anticheat import compute_telemetry_penalty

    focused = [_FakeMove(i + 1, 4500 + (i % 2) * 100, blurred=False) for i in range(12)]
    blurred = [_FakeMove(i + 1, 4500 + (i % 2) * 100, blurred=True) for i in range(12)]
    assert 0 < compute_telemetry_penalty(focused)["penalty"] < compute_telemetry_penalty(blurred)["penalty"]


def test_premove_flag_requires_near_instant_server_timing():
    from src.services.anticheat import trusted_premove

    assert trusted_premove(True, 120) is True
    assert trusted_premove(True, 4500) is False  # «премув» через 4.5 с — подделка
    assert trusted_premove(False, 50) is False


def test_public_profile_hides_fair_play_data(client, test_user_1):
    body = client.get(f"/api/v1/profile/{test_user_1.username}").json()
    assert "trust_factor" not in body and "is_cheater" not in body


# --- Предложение ничьей -----------------------------------------------------------------

async def test_draw_offer_expires_when_opponent_moves():
    from src.services.game_state import state_manager

    await state_manager.initialize_game(game_id=71, white_id=801, black_id=802, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(71, {"draw_offer": "802"})  # чёрные предложили ничью

    await state_manager.process_atomic_move(71, 801, "c1", "e2e4")  # белые ответили ходом
    assert (await state_manager.get_game_state(71))["draw_offer"] == ""


async def test_own_move_keeps_draw_offer():
    from src.services.game_state import state_manager

    await state_manager.initialize_game(game_id=72, white_id=801, black_id=802, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(72, {"draw_offer": "801"})  # белые предложили и ходят

    await state_manager.process_atomic_move(72, 801, "c1", "e2e4")
    assert (await state_manager.get_game_state(72))["draw_offer"] == "801"


def test_every_ws_action_has_a_handler():
    from src.api.websockets import ACTION_HANDLERS

    expected = {
        "join_queue", "leave_queue", "accept_challenge", "create_invite", "accept_invite",
        "spectate_game", "leave_spectate", "chat_message", "abort_game", "resign",
        "offer_draw", "accept_draw", "decline_draw", "offer_rematch", "accept_rematch",
        "decline_rematch", "make_move",
    }
    assert set(ACTION_HANDLERS) == expected
