# --- FILE: tests/test_auth_sessions.py ---
"""Сессии входа (таск 17.5): короткий access-токен + refresh-токен в httpOnly-cookie, обновление и отзыв."""

from src.services import auth_sessions

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
PASSWORD = "secret123"


def _login(client, name: str = "Sessioner"):
    client.post(REGISTER, json={"username": name, "password": PASSWORD})
    return client.post(LOGIN, data={"username": name, "password": PASSWORD})


def _me(client, token: str):
    return client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {token}"})


def test_login_sets_an_http_only_strict_cookie_for_auth_paths_only(client):
    res = _login(client)
    assert res.status_code == 200 and res.json()["access_token"]
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{auth_sessions.REFRESH_COOKIE}=")
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/api/v1/auth" in cookie
    assert "Max-Age=2592000" in cookie  # 30 суток


def test_refresh_gives_a_working_access_token(client):
    _login(client)
    res = client.post(REFRESH)
    assert res.status_code == 200
    assert _me(client, res.json()["access_token"]).json()["username"] == "Sessioner"


def test_without_cookie_refresh_is_401(client):
    res = client.post(REFRESH)
    assert res.status_code == 401 and res.json()["detail"]["code"] == "not_authenticated"


def test_logout_revokes_the_session_and_clears_the_cookie(client):
    _login(client)
    res = client.post(LOGOUT)
    assert res.status_code == 204 and 'Max-Age=0' in res.headers["set-cookie"]
    assert client.post(REFRESH).status_code == 401


def test_logout_everywhere_revokes_refresh_sessions(client):
    token = _login(client).json()["access_token"]
    stolen = client.cookies.get(auth_sessions.REFRESH_COOKIE)
    assert client.post("/api/v1/auth/logout-all", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    client.cookies.set(auth_sessions.REFRESH_COOKIE, stolen, path="/api/v1/auth")
    assert client.post(REFRESH).status_code == 401


def test_password_change_keeps_this_client_and_drops_the_others(client):
    token = _login(client).json()["access_token"]
    other_device = client.cookies.get(auth_sessions.REFRESH_COOKIE)
    res = client.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {token}"},
                      json={"current_password": PASSWORD, "new_password": "another-secret"})
    assert res.status_code == 200
    assert client.post(REFRESH).status_code == 200  # новая cookie этого клиента
    client.cookies.set(auth_sessions.REFRESH_COOKIE, other_device, path="/api/v1/auth")
    assert client.post(REFRESH).status_code == 401


def test_deleted_account_cannot_refresh(client):
    token = _login(client).json()["access_token"]
    res = client.post("/api/v1/account/delete", headers={"Authorization": f"Bearer {token}"},
                      json={"password": PASSWORD})
    assert res.status_code == 204
    assert client.post(REFRESH).status_code == 401


async def test_sessions_are_stored_as_hashes():
    token = await auth_sessions.issue(7, 3)
    assert await auth_sessions.lookup(token) == (7, 3)
    from src.db import redis as redis_module
    assert await redis_module.redis_client.get(f"{auth_sessions.REFRESH_PREFIX}{token}") is None  # не в открытом виде
    await auth_sessions.revoke(token)
    assert await auth_sessions.lookup(token) is None
