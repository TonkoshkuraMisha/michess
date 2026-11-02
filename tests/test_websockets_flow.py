# --- FILE: tests/test_websockets_flow.py ---

import json
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from src.main import app


def test_websocket_unauthorized_access(client: TestClient):
    try:
        with client.websocket_connect("/api/v1/ws/matchmaking?token=invalid_token") as websocket:
            pass
    except WebSocketDisconnect as e:
        # 1008 Policy Violation / закрытие из-за неверного токена — ожидаемое поведение
        assert e.code == 1008


@pytest.mark.asyncio
async def test_premove_telemetry_saved_and_bot_thinking_time():
    """Проверяет сохранение флага is_premove=True в Redis-телеметрии и расчёт времени хода бота."""
    import chess
    from src.services.game_state import state_manager
    from src.api.bots import calculate_authentic_thinking_time_ms

    game_id = 999123
    await state_manager.redis.delete(f"game:{game_id}:moves")

    await state_manager.save_move_telemetry(game_id, {
        "player_id": 1,
        "move_number": 1,
        "notation": "g1f3",
        "san": "Nf3",
        "fen_after": chess.Board().fen(),
        "time_taken_ms": 0,
        "window_blurred_before_move": False,
        "is_premove": True,
        "network_lag_ms": 5,
    })

    raw_moves = await state_manager.redis.lrange(f"game:{game_id}:moves", 0, -1)
    assert len(raw_moves) == 1
    saved = json.loads(raw_moves[0])
    assert saved["is_premove"] is True
    assert saved["time_taken_ms"] == 0

    # Проверка тайминга: Морфи из книги думает быстрее, чем Паульсен в расчёте
    board = chess.Board()
    morphy_book_ms = calculate_authentic_thinking_time_ms("morphy", board, "e2e4", "book")
    paulsen_engine_ms = calculate_authentic_thinking_time_ms("paulsen", board, "e2e4", "engine")
    assert 200 <= morphy_book_ms < paulsen_engine_ms <= 3000


@pytest.mark.asyncio
async def test_rematch_swaps_colors(db_session):
    """Проверяет, что при принятии реванша создаётся новая партия со сменой цветов (white_id <-> black_id)."""
    from src.models.user import User
    from src.api.websockets import create_rematch_game
    from src.services.game_state import state_manager

    p1 = User(username="rematch_p1", hashed_password="pw", rating=1600)
    p2 = User(username="rematch_p2", hashed_password="pw", rating=1650)
    db_session.add_all([p1, p2])
    await db_session.commit()
    await db_session.refresh(p1)
    await db_session.refresh(p2)

    prev_state = {
        "white_id": str(p1.id),
        "black_id": str(p2.id),
        "base_time_ms": "300000",
        "increment_ms": "3000",
    }

    rematch_info = await create_rematch_game(db_session, prev_state)
    assert rematch_info["white_id"] == p2.id
    assert rematch_info["black_id"] == p1.id
    assert rematch_info["base_time_ms"] == 300000
    assert rematch_info["increment_ms"] == 3000

    new_state = await state_manager.get_game_state(rematch_info["game_id"])
    assert int(new_state["white_id"]) == p2.id
    assert int(new_state["black_id"]) == p1.id
