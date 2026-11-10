# --- FILE: tests/test_deploy_config.py ---
"""
Готовность к продакшену: /health проверяет зависимости, продакшен-режим не стартует со слабым
SECRET_KEY и прячет документацию, CORS_ORIGINS задаётся из окружения.
"""

import pytest
from pydantic import ValidationError

from src import main as main_module
from src.core.config import Settings, settings

BASE_ENV = {
    "POSTGRES_USER": "u", "POSTGRES_PASSWORD": "p", "POSTGRES_SERVER": "db",
    "POSTGRES_PORT": "5432", "POSTGRES_DB": "d",
}
STRONG_KEY = "k3Jx9-" * 8


def _settings(monkeypatch, **env) -> Settings:
    for key, value in {**BASE_ENV, **env}.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


# --- /health ---------------------------------------------------------------------------------

@pytest.fixture
def database_ok(monkeypatch):
    async def ok():
        return None

    monkeypatch.setattr(main_module, "_check_database", ok)


def test_health_reports_ok_when_dependencies_answer(client, database_ok):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["checks"] == {"database": "ok", "redis": "ok"}


def test_health_is_503_when_redis_is_down(client, database_ok, monkeypatch):
    from src.db import redis as redis_module

    async def broken_ping():
        raise ConnectionError("redis is down")

    monkeypatch.setattr(redis_module.redis_client, "ping", broken_ping)
    res = client.get("/health")
    assert res.status_code == 503
    assert res.json()["checks"]["redis"] == "unavailable"


def test_health_is_503_when_database_is_down(client, monkeypatch):
    async def broken():
        raise OSError("connection refused")

    monkeypatch.setattr(main_module, "_check_database", broken)
    res = client.get("/health")
    assert res.status_code == 503
    assert res.json()["checks"]["database"] == "unavailable"


def test_debug_echo_websocket_is_gone():
    paths = {getattr(route, "path", None) for route in main_module.app.routes}
    assert "/ws/ping" not in paths


# --- Настройки --------------------------------------------------------------------------------

@pytest.mark.parametrize("weak_key", ["test", "change-me-dev-only-secret-key", "x" * 31])
def test_production_refuses_weak_secret_key(monkeypatch, weak_key):
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        _settings(monkeypatch, ENVIRONMENT="production", SECRET_KEY=weak_key)


def test_production_accepts_strong_secret_key(monkeypatch):
    assert _settings(monkeypatch, ENVIRONMENT="production", SECRET_KEY=STRONG_KEY).is_production


def test_development_allows_simple_secret_key(monkeypatch):
    assert not _settings(monkeypatch, ENVIRONMENT="development", SECRET_KEY="dev").is_production


@pytest.mark.parametrize("raw, expected", [
    ("https://a.example, https://b.example", ["https://a.example", "https://b.example"]),
    ('["https://c.example"]', ["https://c.example"]),
    ("", []),
])
def test_cors_origins_from_environment(monkeypatch, raw, expected):
    assert expected == _settings(monkeypatch, SECRET_KEY="dev", CORS_ORIGINS=raw).CORS_ORIGINS


def test_production_hides_api_docs(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    app = main_module.create_app()
    assert app.docs_url is None
    assert app.openapi_url is None

    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    assert main_module.create_app().docs_url == "/docs"
