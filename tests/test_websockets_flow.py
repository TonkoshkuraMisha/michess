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