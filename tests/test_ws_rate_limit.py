# --- FILE: tests/test_ws_rate_limit.py ---
"""
Ограничение частоты сообщений WebSocket: чат и предложения нельзя использовать для спама,
поток мусора закрывает соединение, а отклонённый по лимиту ход возвращает клиенту позицию.
"""

import asyncio
import json

import pytest
from fastapi import WebSocketDisconnect

from src.api import websockets as ws_module
from src.api.websockets import matchmaking_endpoint
from src.models.user import User
from src.services.game_state import state_manager

_CLOSE = object()


class _NoDbSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, *args, **kwargs):
        return None


class QueueSocket:
    def __init__(self):
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []
        self.closed_with: int | None = None

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))

    async def receive_text(self):
        item = await self.incoming.get()
        if item is _CLOSE:
            raise WebSocketDisconnect(code=1000)
        return item if isinstance(item, str) else json.dumps(item)

    async def close(self, code: int = 1000):
        self.closed_with = code

    def events(self, event: str) -> list[dict]:
        return [m for m in self.sent if m.get("event") == event]


async def _run(user: User, messages: list, *, close: bool = True) -> QueueSocket:
    """Прогоняет сообщения через эндпоинт и дожидается, пока он их обработает."""
    socket = QueueSocket()
    for message in messages:
        socket.incoming.put_nowait(message)
    if close:
        socket.incoming.put_nowait(_CLOSE)
    await asyncio.wait_for(matchmaking_endpoint(socket, user, _NoDbSession), timeout=5)
    return socket


def _user(user_id: int) -> User:
    return User(
        id=user_id, username=f"u{user_id}", bullet_rating=1500, blitz_rating=1500, rapid_rating=1500, classical_rating=1500
    )


@pytest.fixture
async def game():
    await state_manager.initialize_game(game_id=81, white_id=901, black_id=902, base_time_ms=60000, increment_ms=0)
    return 81


async def test_chat_flood_is_cut_off(game):
    chat = {"action": "chat_message", "game_id": game, "text": "спам"}
    socket = await _run(_user(901), [chat] * 7)

    assert len(socket.events("chat_message")) == ws_module.WS_RATE_LIMITS["chat"][0]
    errors = socket.events("error")
    assert [e["code"] for e in errors] == ["rate_limited", "rate_limited"]
    assert errors[0]["action"] == "chat_message"


async def test_limit_is_shared_between_tabs_of_one_user(game):
    chat = {"action": "chat_message", "game_id": game, "text": "привет"}
    first_tab = await _run(_user(901), [chat] * 5)
    second_tab = await _run(_user(901), [chat])

    assert len(first_tab.events("chat_message")) == 5
    assert second_tab.events("error")[0]["code"] == "rate_limited"


async def test_rate_limited_move_returns_current_position(game, monkeypatch):
    monkeypatch.setitem(ws_module.WS_RATE_LIMITS, "moves", (1, 10))
    move = {"action": "make_move", "game_id": game, "move": "e2e4", "state_version": 0}
    socket = await _run(_user(901), [move, {**move, "move": "d2d4", "command_id": "second"}])

    assert len(socket.events("move_made")) == 1
    error = socket.events("error")[0]
    assert error["code"] == "rate_limited"
    # Клиент уже нарисовал d2d4 — сервер возвращает позицию после e2e4, чтобы доска синхронизировалась.
    assert "e4" in error["pgn"] and "d4" not in error["pgn"]
    assert error["state_version"] == 1


async def test_oversized_message_is_rejected():
    huge = json.dumps({"action": "chat_message", "game_id": 1, "text": "x" * ws_module.WS_MAX_MESSAGE_CHARS})
    socket = await _run(_user(903), [huge])
    assert socket.events("error")[0]["code"] == "message_too_large"


async def test_garbage_does_not_break_the_connection():
    socket = await _run(_user(904), ["not json", "[1, 2]", {"action": "leave_queue"}])
    assert socket.events("queue_left")  # соединение живо, следующее действие выполнено
    assert socket.closed_with is None


async def test_flooding_connection_is_closed(monkeypatch):
    monkeypatch.setattr(ws_module, "WS_MAX_STRIKES", 5)
    socket = await _run(_user(905), ["garbage"] * 5, close=False)  # эндпоинт завершается сам
    assert socket.closed_with == ws_module.WS_CLOSE_POLICY_VIOLATION


async def test_draw_can_be_offered_once_per_move(game):
    offer = {"action": "offer_draw", "game_id": game}
    socket = await _run(_user(901), [offer, offer])
    assert socket.events("error")[0]["code"] == "draw_offer_too_soon"

    # Соперник отклонил, позиция не изменилась — повторить нельзя.
    await state_manager.update_game_state(game, {"draw_offer": ""})
    socket = await _run(_user(901), [offer])
    assert socket.events("error")[0]["code"] == "draw_offer_too_soon"

    # После хода — снова можно.
    await state_manager.update_game_state(game, {"state_version": "2"})
    socket = await _run(_user(901), [offer])
    assert not socket.events("error")
    state = await state_manager.get_game_state(game)
    assert state["draw_offer"] == "901"
