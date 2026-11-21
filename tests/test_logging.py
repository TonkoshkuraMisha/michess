# --- FILE: tests/test_logging.py ---
"""
Журналы (src/core/logging_setup.py, src/api/client_errors.py): контекст записи, формат json, номер запроса
X-Request-ID, отчёты клиента об ошибках и след WebSocket. Журнал перехватывается обработчиком, который форматирует
запись в момент выпуска — когда контекст ещё привязан (caplog хранит только готовые записи без контекста).
"""

import json
import logging

import pytest

from src.core import logging_setup as ls
from src.core.config import settings

REGISTER = "/api/v1/auth/register"
CLIENT_ERRORS = "/api/v1/client-errors"


class _Capture(logging.Handler):
    """Складывает записи как json-словари, отформатированные сразу при выпуске."""

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.rows: list[dict] = []
        self._formatter = ls.JsonFormatter("test")

    def emit(self, record: logging.LogRecord) -> None:
        self.rows.append(json.loads(self._formatter.format(record)))

    def named(self, msg: str) -> list[dict]:
        return [row for row in self.rows if row["msg"] == msg]


@pytest.fixture
def captured():
    handler = _Capture()
    root = logging.getLogger()
    previous = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    yield handler
    root.removeHandler(handler)
    root.setLevel(previous)


def test_json_formatter_merges_context_extra_and_exception():
    token = ls.start_log_context(request_id="abc12345", user_id=7)
    try:
        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "boom %s", ("x",), None)
        record.game_id = 42
        try:
            raise ValueError("bad")
        except ValueError:
            import sys
            record.exc_info = sys.exc_info()
        row = json.loads(ls.JsonFormatter("api").format(record))
    finally:
        ls.end_log_context(token)
    assert row["msg"] == "boom x" and row["level"] == "ERROR" and row["component"] == "api"
    assert (row["request_id"], row["user_id"], row["game_id"]) == ("abc12345", 7, 42)
    assert "ValueError: bad" in row["exc"] and row["ts"].endswith("+00:00")


def test_text_formatter_puts_context_in_brackets():
    token = ls.start_log_context(request_id="abc12345")
    try:
        record = logging.LogRecord("t", logging.INFO, __file__, 1, "hello", (), None)
        line = ls.TextFormatter().format(record)
    finally:
        ls.end_log_context(token)
    assert line.endswith("hello [request_id=abc12345]")


def test_context_is_scoped_and_none_values_are_skipped():
    assert ls.current_log_context() == {}
    token = ls.start_log_context(request_id="r1", game_id=None)
    ls.bind_log_context(user_id=3)
    assert ls.current_log_context() == {"request_id": "r1", "user_id": 3}
    ls.unbind_log_context("user_id")
    assert ls.current_log_context() == {"request_id": "r1"}
    ls.end_log_context(token)
    assert ls.current_log_context() == {}


@pytest.mark.parametrize(("configured", "production", "expected"), [
    ("json", False, "json"), ("text", True, "text"), ("auto", True, "json"), ("auto", False, "text"),
])
def test_format_resolution(monkeypatch, configured, production, expected):
    monkeypatch.setattr(settings, "LOG_FORMAT", configured)
    monkeypatch.setattr(type(settings), "is_production", property(lambda _self: production))
    assert ls.resolve_format() == expected


def test_response_carries_request_id_and_access_line_is_logged(client, captured):
    res = client.get("/health")
    assert res.headers["X-Request-ID"]
    mine = [row for row in captured.named("http_request") if row["request_id"] == res.headers["X-Request-ID"]]
    assert mine and mine[0]["route"] == "/health" and mine[0]["status"] == res.status_code
    assert mine[0]["level"] == "DEBUG"  # опрос здоровья не засоряет журнал


def test_safe_client_request_id_is_kept_and_unsafe_is_replaced(client):
    assert client.get("/health", headers={"X-Request-ID": "client-req-12345"}).headers["X-Request-ID"] == "client-req-12345"
    replaced = client.get("/health", headers={"X-Request-ID": "bad id\twith spaces"}).headers["X-Request-ID"]
    assert ls.REQUEST_ID_PATTERN.match(replaced) and replaced != "bad id\twith spaces"


def test_route_template_is_logged_not_the_raw_path(client, captured):
    client.get("/api/v1/profile/some_player_name")
    routes = [row["route"] for row in captured.named("http_request")]
    assert routes and all("some_player_name" not in r for r in routes)


def test_secrets_never_reach_the_log(client, captured):
    client.post(REGISTER, json={"username": "LogProbe", "password": "hunter2-very-secret"})
    assert "hunter2-very-secret" not in json.dumps(captured.rows, ensure_ascii=False)


def test_authenticated_request_binds_user_id(client, captured, token_user_1):
    res = client.get("/api/v1/messages/unread", headers={"Authorization": f"Bearer {token_user_1}"})
    rid = res.headers["X-Request-ID"]
    row = next(r for r in captured.named("http_request") if r["request_id"] == rid)
    assert row.get("user_id")


def test_client_error_is_logged_with_breadcrumbs_and_related_request_ids(client, captured):
    body = {
        "kind": "reload", "message": "page reloaded during a game", "url": "/play", "release": "1.2.2", "game_id": 77,
        "breadcrumbs": [
            {"t": 1, "kind": "request", "name": "GET /tournaments/2", "status": 200, "request_id": "req-abcdef01"},
            {"t": 2, "kind": "socket", "name": "move accepted"},
        ],
    }
    res = client.post(CLIENT_ERRORS, json=body)
    assert res.status_code == 204
    row = captured.named("client_error")[0]
    assert row["level"] == "ERROR" and row["client_kind"] == "reload" and row["game_id"] == 77
    assert row["related_request_ids"] == ["req-abcdef01"] and len(row["breadcrumbs"]) == 2


def test_client_error_validation_and_size_limits(client):
    assert client.post(CLIENT_ERRORS, json={"kind": "nope", "message": "m", "url": "/"}).status_code == 422
    assert client.post(CLIENT_ERRORS, json={"kind": "error", "message": "x" * 501, "url": "/"}).status_code == 422
    too_many = [{"t": i, "kind": "route", "name": "p"} for i in range(31)]
    body = {"kind": "error", "message": "m", "url": "/", "breadcrumbs": too_many}
    assert client.post(CLIENT_ERRORS, json=body).status_code == 422


def test_client_errors_over_the_limit_are_dropped_silently(client, captured, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_CLIENT_ERRORS", 2)
    body = {"kind": "error", "message": "m", "url": "/"}
    statuses = [client.post(CLIENT_ERRORS, json=body).status_code for _ in range(4)]
    assert statuses == [204, 204, 204, 204]  # клиенту о лимите не сообщаем
    assert len(captured.named("client_error")) == 2


async def test_websocket_leaves_a_trail(client, captured, monkeypatch):
    from src.api.deps import get_current_user_ws
    from src.db.session import get_session_factory
    from src.main import app
    from src.models.user import User
    from tests.test_disconnect_clock import _NoDbSession

    player = User(id=601, username="trail", bullet_rating=1500, blitz_rating=1500, rapid_rating=1500, classical_rating=1500)

    async def _user():
        return player

    monkeypatch.setitem(app.dependency_overrides, get_current_user_ws, _user)
    monkeypatch.setitem(app.dependency_overrides, get_session_factory, lambda: _NoDbSession)
    with client.websocket_connect("/api/v1/ws/matchmaking?ticket=unused") as tab:
        tab.send_json({"action": "leave_queue", "game_id": 5})
        assert any(tab.receive_json()["event"] == "queue_left" for _ in range(5))
    connected = captured.named("ws_connected")[0]
    assert connected["user_id"] == 601 and connected["channel"] == "ws" and connected["ws_id"]
    action = captured.named("ws_action")[0]
    assert action["action"] == "leave_queue" and action["game_id"] == 5 and action["outcome"] == "ok"
    assert captured.named("ws_disconnected")
    # game_id не «прилипает» к следующим строкам соединения
    assert "game_id" not in captured.named("ws_disconnected")[0]


def test_unhandled_error_returns_500_with_code_and_request_id(captured):
    from fastapi.testclient import TestClient

    from src.main import app

    def boom():
        raise RuntimeError("kaput")

    app.add_api_route("/__boom", boom)
    try:
        res = TestClient(app, raise_server_exceptions=False).get("/__boom", headers={"X-Request-ID": "boom-req-123456"})
    finally:
        app.router.routes.pop()
    assert res.status_code == 500 and res.headers["X-Request-ID"] == "boom-req-123456"
    assert res.json()["detail"]["code"] == "internal_error"
    failure = captured.named("http_unhandled_error")[0]
    assert failure["request_id"] == "boom-req-123456" and "RuntimeError: kaput" in failure["exc"]
