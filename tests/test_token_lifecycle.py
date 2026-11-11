# --- FILE: tests/test_token_lifecycle.py ---
"""
Жизненный цикл токенов: sub = id пользователя, отзыв всех токенов (смена пароля, «выйти на
всех устройствах») и одноразовые тикеты для WebSocket вместо JWT в адресе.
"""

import json

import jwt
import pytest
from fastapi import WebSocketException

from src.api.deps import get_current_user_ws
from src.core.config import settings
from src.core.security import create_access_token, create_user_token
from src.models.user import User
from src.services.connection_manager import (
    SESSION_REVOKED_EVENT,
    WS_CLOSE_SESSION_REVOKED,
    ConnectionManager,
)

PASSWORD = "secret123"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client, username: str = "tokenuser") -> str:
    assert client.post("/api/v1/auth/register", json={"username": username, "password": PASSWORD}).status_code == 201
    res = client.post("/api/v1/auth/login", data={"username": username, "password": PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _me(client, token: str):
    return client.get("/api/v1/profile/me", headers=_auth(token))


class _NoDbFactory:
    """Фабрика сессий для get_current_user_ws: отдаёт заранее известного пользователя."""

    def __init__(self, user: User | None):
        self.user = user

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def in_transaction(self):
        return False

    async def get(self, model, pk):
        return self.user if self.user is not None and self.user.id == pk else None


# --- Формат токена -------------------------------------------------------------------------

def test_token_subject_is_user_id_with_version(client):
    token = _register_and_login(client)
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    me = _me(client, token).json()
    assert payload["sub"] == str(me["id"])
    assert payload["ver"] == 0


def test_old_format_token_is_rejected(client):
    """Токены, выданные до перехода (sub = имя пользователя), больше не принимаются."""
    _register_and_login(client, "legacy")
    legacy_token = create_access_token({"sub": "legacy"})
    assert _me(client, legacy_token).status_code == 401


# --- Отзыв токенов -------------------------------------------------------------------------

def test_logout_everywhere_revokes_all_tokens(client):
    token = _register_and_login(client)
    second_device = client.post("/api/v1/auth/login", data={"username": "tokenuser", "password": PASSWORD})
    other_token = second_device.json()["access_token"]
    assert _me(client, other_token).status_code == 200

    assert client.post("/api/v1/auth/logout-all", headers=_auth(token)).status_code == 204

    assert _me(client, token).status_code == 401
    assert _me(client, other_token).status_code == 401
    # Новый вход выдаёт рабочий токен.
    fresh = client.post("/api/v1/auth/login", data={"username": "tokenuser", "password": PASSWORD})
    assert _me(client, fresh.json()["access_token"]).status_code == 200


def test_change_password_revokes_old_tokens_and_keeps_current_session(client):
    token = _register_and_login(client)

    wrong = client.post("/api/v1/auth/change-password", headers=_auth(token),
                        json={"current_password": "not-it", "new_password": "brand-new-pass"})
    assert wrong.status_code == 400
    assert _me(client, token).status_code == 200  # неудачная попытка ничего не отзывает

    res = client.post("/api/v1/auth/change-password", headers=_auth(token),
                      json={"current_password": PASSWORD, "new_password": "brand-new-pass"})
    assert res.status_code == 200
    new_token = res.json()["access_token"]

    assert _me(client, token).status_code == 401
    assert _me(client, new_token).status_code == 200
    assert client.post("/api/v1/auth/login", data={"username": "tokenuser", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/login",
                       data={"username": "tokenuser", "password": "brand-new-pass"}).status_code == 200


# --- Тикеты WebSocket ------------------------------------------------------------------------

def test_ws_ticket_requires_authentication(client):
    assert client.post("/api/v1/auth/ws-ticket").status_code == 401


async def test_ws_ticket_works_exactly_once(client):
    token = _register_and_login(client)
    me = _me(client, token).json()
    res = client.post("/api/v1/auth/ws-ticket", headers=_auth(token))
    assert res.status_code == 200
    ticket = res.json()["ticket"]
    assert token not in ticket

    user = User(
        id=me["id"], username=me["username"], bullet_rating=1200,
        blitz_rating=1200, rapid_rating=1200, classical_rating=1200, token_version=0
    )
    authed = await get_current_user_ws(ticket=ticket, session_factory=_NoDbFactory(user))
    assert authed.id == me["id"]

    with pytest.raises(WebSocketException) as exc_info:
        await get_current_user_ws(ticket=ticket, session_factory=_NoDbFactory(user))
    assert exc_info.value.code == 1008


async def test_ws_ticket_is_void_after_tokens_are_revoked(client):
    token = _register_and_login(client)
    me = _me(client, token).json()
    ticket = client.post("/api/v1/auth/ws-ticket", headers=_auth(token)).json()["ticket"]

    # Между выдачей тикета и подключением пользователь вышел на всех устройствах.
    revoked_user = User(
        id=me["id"], username=me["username"], bullet_rating=1200,
        blitz_rating=1200, rapid_rating=1200, classical_rating=1200, token_version=1
    )
    with pytest.raises(WebSocketException):
        await get_current_user_ws(ticket=ticket, session_factory=_NoDbFactory(revoked_user))


async def test_unknown_ticket_is_rejected():
    with pytest.raises(WebSocketException) as exc_info:
        await get_current_user_ws(ticket="made-up", session_factory=_NoDbFactory(None))
    assert exc_info.value.code == 1008


def test_ws_ticket_issuance_is_rate_limited(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_WS_TICKETS", 2)
    token = _register_and_login(client)
    codes = [client.post("/api/v1/auth/ws-ticket", headers=_auth(token)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


# --- Закрытие открытых WebSocket при отзыве -------------------------------------------------

class _Socket:
    def __init__(self):
        self.sent: list[dict] = []
        self.closed_with: int | None = None

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))

    async def close(self, code: int = 1000):
        self.closed_with = code


async def test_revoke_sessions_notifies_and_closes_local_tabs():
    cm = ConnectionManager()
    tab1, tab2, other_user = _Socket(), _Socket(), _Socket()
    await cm.connect(tab1, user_id=41)
    await cm.connect(tab2, user_id=41)
    await cm.connect(other_user, user_id=42)

    await cm.revoke_sessions(41)

    for tab in (tab1, tab2):
        assert tab.sent[-1]["event"] == SESSION_REVOKED_EVENT
        assert tab.closed_with == WS_CLOSE_SESSION_REVOKED
    assert other_user.closed_with is None


async def test_revocation_from_another_worker_closes_tabs_here():
    cm = ConnectionManager()
    tab = _Socket()
    await cm.connect(tab, user_id=43)

    await cm._on_remote_message(43, json.dumps({"event": "chat_message", "text": SESSION_REVOKED_EVENT}))
    assert tab.closed_with is None  # слово в тексте чата — не событие отзыва

    await cm._on_remote_message(43, json.dumps({"event": SESSION_REVOKED_EVENT}))
    assert tab.closed_with == WS_CLOSE_SESSION_REVOKED


def test_user_token_helper_matches_login_format():
    user = User(
        id=7, username="x", bullet_rating=1200, blitz_rating=1200, rapid_rating=1200, classical_rating=1200, token_version=3
    )
    payload = jwt.decode(create_user_token(user), settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert (payload["sub"], payload["ver"]) == ("7", 3)
