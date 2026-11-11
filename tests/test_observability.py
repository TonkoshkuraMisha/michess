"""
Наблюдаемость: метрики Prometheus (HTTP, WS-действия, пул БД) и подключение Sentry только по DSN.
"""

import pytest
from prometheus_client import REGISTRY
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool

from src.api import websockets as ws_module
from src.core import observability as obs
from src.core.config import settings
from src.models.user import User
from src.services.matchmaker import MatchmakingError


def _sample(name: str, **labels) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


class _NoDbSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def in_transaction(self):
        return False


@pytest.fixture
def silent_send(monkeypatch):
    sent: list[dict] = []

    async def fake_send(payload, user_id):
        sent.append(payload)

    monkeypatch.setattr(ws_module.manager, "send_personal_message", fake_send)
    return sent


# --- /metrics и HTTP --------------------------------------------------------------------------

def test_metrics_endpoint_exposes_application_metrics(client):
    res = client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/plain")
    for name in ("michess_ws_connections", "michess_ws_actions_total", "michess_db_pool_checked_out",
                 "michess_games_finished_total", "michess_http_requests_total"):
        assert name in res.text


def test_http_requests_are_counted_by_route_template(client):
    route = "/api/v1/profile/{username}"
    before = _sample("michess_http_requests_total", method="GET", route=route, status="404")
    client.get("/api/v1/profile/nobody_with_this_name")
    client.get("/api/v1/profile/another_missing_name")
    # Метка — шаблон маршрута, а не путь: два разных имени дают один временной ряд.
    assert _sample("michess_http_requests_total", method="GET", route=route, status="404") == before + 2


def test_metrics_scrapes_are_not_counted(client):
    before = _sample("michess_http_requests_total", method="GET", route="/metrics", status="200")
    client.get("/metrics")
    assert _sample("michess_http_requests_total", method="GET", route="/metrics", status="200") == before


# --- WebSocket-действия -------------------------------------------------------------------------

@pytest.mark.parametrize("raised, outcome", [
    (None, obs.OUTCOME_OK),
    (ws_module._Ignore(), obs.OUTCOME_IGNORED),
    (MatchmakingError("busy", "Соперник занят"), obs.OUTCOME_REJECTED),
    (RuntimeError("boom"), obs.OUTCOME_ERROR),
])
async def test_ws_action_outcome_and_duration_are_recorded(silent_send, raised, outcome):
    async def handler(ctx, data):
        if raised is not None:
            raise raised

    user = User(id=901, username="metrics_user")
    count_before = _sample("michess_ws_actions_total", action="make_move", outcome=outcome)
    observed_before = _sample("michess_ws_action_seconds_count", action="make_move")

    await ws_module._dispatch_action(lambda: _NoDbSession(), user, "make_move", handler, {})

    assert _sample("michess_ws_actions_total", action="make_move", outcome=outcome) == count_before + 1
    assert _sample("michess_ws_action_seconds_count", action="make_move") == observed_before + 1


async def test_rate_limited_ws_action_is_counted(silent_send, monkeypatch):
    async def over_limit(user_id, action_name):
        return False

    monkeypatch.setattr(ws_module, "_within_rate_limit", over_limit)
    before = _sample("michess_ws_actions_total", action="chat_message", outcome=obs.OUTCOME_RATE_LIMITED)

    accepted = await ws_module._handle_message(
        lambda: _NoDbSession(), User(id=902, username="spammer"), '{"action": "chat_message", "message": "hi"}',
    )

    assert accepted is False
    assert _sample("michess_ws_actions_total", action="chat_message", outcome=obs.OUTCOME_RATE_LIMITED) == before + 1


# --- Пул БД и метки -----------------------------------------------------------------------------

async def test_pool_gauge_follows_checkout_and_checkin(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{(tmp_path / 'gauge.db').as_posix()}", poolclass=AsyncAdaptedQueuePool,
    )
    obs.instrument_engine(engine)
    base = _sample("michess_db_pool_checked_out")
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            assert _sample("michess_db_pool_checked_out") == base + 1
        assert _sample("michess_db_pool_checked_out") == base
    finally:
        await engine.dispose()


@pytest.mark.parametrize("raw, label", [
    ("checkmate", "checkmate"),
    ("FIVEFOLD_REPETITION", "fivefold_repetition"),
    ("", "other"),
    (None, "other"),
    ("user-controlled; DROP", "other"),
    ("x" * 41, "other"),
])
def test_bounded_label_keeps_label_set_finite(raw, label):
    assert obs.bounded_label(raw) == label


# --- Sentry -------------------------------------------------------------------------------------

def test_sentry_is_off_without_dsn(monkeypatch):
    monkeypatch.setattr(settings, "SENTRY_DSN", "")
    assert obs.init_sentry("api") is False


def test_sentry_init_does_not_send_personal_data(monkeypatch):
    import sentry_sdk

    calls: list[dict] = []
    tags: list[tuple[str, str]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(sentry_sdk, "set_tag", lambda key, value: tags.append((key, value)))
    monkeypatch.setattr(settings, "SENTRY_DSN", "https://key@sentry.example/1")

    assert obs.init_sentry("worker") is True
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["release"] == f"michess@{settings.VERSION}"
    assert calls[0]["traces_sample_rate"] == settings.SENTRY_TRACES_SAMPLE_RATE
    assert tags == [("component", "worker")]


class _Route:
    def __init__(self, path_format: str):
        self.path_format = path_format


@pytest.mark.parametrize("path, template, label", [
    ("/api/v1/profile/alice", "/profile/{username}", "/api/v1/profile/{username}"),  # префикс роутера не в шаблоне
    ("/api/v1/profile/alice", "/api/v1/profile/{username}", "/api/v1/profile/{username}"),  # уже полный шаблон
    ("/api/v1/bots/list", "/list", "/api/v1/bots/list"),
    ("/health", "/health", "/health"),
    ("/files/a/b/c", "/files/{rest:path}", "/files/{rest:path}"),
])
def test_route_template_restores_router_prefix(path, template, label):
    assert obs.route_template({"path": path, "route": _Route(template)}) == label


def test_route_template_for_unmatched_request():
    assert obs.route_template({"path": "/nowhere"}) == "unmatched"
