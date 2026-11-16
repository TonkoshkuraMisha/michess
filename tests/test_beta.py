# --- FILE: tests/test_beta.py ---
"""Программа беты (таск 24.4): закрытая регистрация по приглашениям, «Сообщить о проблеме», сводка за неделю."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.core.config import settings
from src.models.beta import Feedback, Invite
from src.models.user import User
from src.services import beta

API = "/api/v1/beta"
REGISTER = "/api/v1/auth/register"
PASSWORD = "correct-horse-battery"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def register(client, username: str, code: str | None = None):
    body = {"username": username, "password": PASSWORD}
    if code is not None:
        body["invite_code"] = code
    return client.post(REGISTER, json=body)


@pytest.fixture
async def moderator(db_session):
    from src.core.security import create_user_token

    user = User(username="mod", hashed_password="x", is_moderator=True)
    db_session.add(user)
    await db_session.commit()
    return user, create_user_token(user)


@pytest.fixture
def invite_only(monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_INVITE_ONLY", True)
    # Регистраций в тесте больше, чем разрешает лимит на адрес.
    monkeypatch.setattr(settings, "RATE_LIMIT_REGISTER_PER_IP", 100)


# --- настройки сайта ----------------------------------------------------------------------------------------------

def test_config_defaults_open_registration_and_no_community_link(client):
    assert client.get(f"{API}/config").json() == {
        "invite_only": False, "community_url": None, "version": settings.VERSION}


@pytest.mark.parametrize(("value", "shown"), [
    ("https://t.me/example", "https://t.me/example"),
    ("  https://t.me/example  ", "https://t.me/example"),
    ("javascript:alert(1)", None),  # ссылкой считается только адрес http(s)
    ("t.me/example", None),
    ("", None),
])
def test_community_link_comes_from_settings(client, monkeypatch, value, shown):
    monkeypatch.setattr(settings, "COMMUNITY_URL", value)
    assert client.get(f"{API}/config").json()["community_url"] == shown


# --- приглашения --------------------------------------------------------------------------------------------------

def test_only_moderator_manages_invites(client, token_user_1, moderator):
    assert client.get(f"{API}/invites").status_code == 401
    for response in (client.get(f"{API}/invites", headers=auth(token_user_1)),
                     client.post(f"{API}/invites", json={}, headers=auth(token_user_1)),
                     client.post(f"{API}/invites/1/revoke", headers=auth(token_user_1))):
        assert response.status_code == 403 and response.json()["detail"]["code"] == "moderator_only"
    missing = client.post(f"{API}/invites/999/revoke", headers=auth(moderator[1]))
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "beta_invite_not_found"


def test_open_registration_needs_no_code_but_counts_a_valid_one(client, moderator):
    _, mod_token = moderator
    invite = client.post(f"{API}/invites", json={"note": "  клуб   в школе "}, headers=auth(mod_token)).json()
    assert invite["note"] == "клуб в школе" and invite["state"] == "active" and invite["max_uses"] is None
    assert len(invite["code"]) == beta.CODE_LENGTH and set(invite["code"]) <= set(beta.CODE_ALPHABET)

    assert register(client, "NoCode").status_code == 201
    assert register(client, "WrongCode", "NOSUCHCODE").status_code == 201  # недействительный код не мешает
    assert register(client, "WithCode", f" {invite['code'].lower()} ").status_code == 201  # регистр и пробелы — не важны
    listed = client.get(f"{API}/invites", headers=auth(mod_token)).json()
    assert listed["invite_only"] is False
    assert [(item["code"], item["uses"]) for item in listed["invites"]] == [(invite["code"], 1)]


def test_invite_only_registration(client, moderator, invite_only):
    _, mod_token = moderator
    without = register(client, "Stranger")
    assert without.status_code == 403 and without.json()["detail"]["code"] == "registration_invite_required"
    wrong = register(client, "Stranger", "NOSUCHCODE")
    assert wrong.status_code == 403 and wrong.json()["detail"]["code"] == "registration_invite_invalid"
    # Без приглашения занятость имени не раскрывается: ответ тот же, что и для свободного имени.
    assert register(client, "mod").json()["detail"]["code"] == "registration_invite_required"

    code = client.post(f"{API}/invites", json={"max_uses": 2}, headers=auth(mod_token)).json()["code"]
    assert client.get(f"{API}/invites/check", params={"code": code}).json() == {"valid": True}
    assert client.get(f"{API}/invites/check", params={"code": "NOSUCHCODE"}).json() == {"valid": False}
    assert register(client, "First", code).status_code == 201
    # Имя занято — регистрация не состоялась, и код при этом не потрачен.
    taken = register(client, "first", code)
    assert taken.status_code == 400 and taken.json()["detail"]["code"] == "username_taken"
    assert register(client, "Second", code).status_code == 201
    third = register(client, "Third", code)
    assert third.status_code == 403 and third.json()["detail"]["code"] == "registration_invite_invalid"

    item = client.get(f"{API}/invites", headers=auth(mod_token)).json()["invites"][0]
    assert (item["uses"], item["max_uses"], item["state"]) == (2, 2, "used_up")
    assert client.get(f"{API}/invites/check", params={"code": code}).json() == {"valid": False}


async def test_revoked_and_expired_invites_are_refused(client, db_session, moderator, invite_only):
    _, mod_token = moderator
    revoked = client.post(f"{API}/invites", json={}, headers=auth(mod_token)).json()
    answer = client.post(f"{API}/invites/{revoked['id']}/revoke", headers=auth(mod_token)).json()
    assert answer["state"] == "revoked" and answer["revoked_at"] is not None
    assert register(client, "Late", revoked["code"]).json()["detail"]["code"] == "registration_invite_invalid"

    expiring = client.post(f"{API}/invites", json={"expires_in_days": 7}, headers=auth(mod_token)).json()
    assert expiring["expires_at"] is not None
    assert register(client, "InTime", expiring["code"]).status_code == 201
    row = (await db_session.execute(select(Invite).where(Invite.id == expiring["id"]))).scalar_one()
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    assert register(client, "TooLate", expiring["code"]).json()["detail"]["code"] == "registration_invite_invalid"
    states = {item["id"]: item["state"] for item in client.get(f"{API}/invites", headers=auth(mod_token)).json()["invites"]}
    assert states == {revoked["id"]: "revoked", expiring["id"]: "expired"}


@pytest.mark.parametrize("body", [{"max_uses": 0}, {"expires_in_days": 0}, {"expires_in_days": 5000}, {"note": "x" * 101}])
def test_invite_limits_are_validated(client, moderator, body):
    assert client.post(f"{API}/invites", json=body, headers=auth(moderator[1])).status_code == 422


def test_invite_check_is_rate_limited(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_INVITE_CHECK", 2)
    for _ in range(2):
        assert client.get(f"{API}/invites/check", params={"code": "ABC"}).status_code == 200
    blocked = client.get(f"{API}/invites/check", params={"code": "ABC"})
    assert blocked.status_code == 429 and blocked.json()["detail"]["code"] == "too_many_invite_checks"


# --- сообщения о проблемах ----------------------------------------------------------------------------------------

REPORT = {"message": "Не открывается задача\nпосле второго хода", "page": "/puzzles/42?theme=fork", "language": "uk",
          "screen": "390x844"}


async def test_guest_and_player_report_a_problem(client, db_session, token_user_1, moderator):
    _, mod_token = moderator
    assert client.post(f"{API}/feedback", json=REPORT).status_code == 201
    mine = client.post(f"{API}/feedback", json={"message": "  Часы спешат  ", "language": "xx"}, headers=auth(token_user_1))
    assert mine.status_code == 201

    assert client.get(f"{API}/feedback").status_code == 401
    assert client.get(f"{API}/feedback", headers=auth(token_user_1)).status_code == 403
    queue = client.get(f"{API}/feedback", headers=auth(mod_token)).json()
    assert queue["counts"] == {"new": 2, "in_progress": 0, "done": 0, "rejected": 0}
    first, second = queue["items"]
    assert first == {
        "id": first["id"], "message": REPORT["message"], "page": REPORT["page"], "app_version": settings.VERSION,
        "language": "uk", "screen": "390x844", "status": "new", "author": None, "created_at": first["created_at"],
        "updated_at": None}
    assert (second["author"], second["message"], second["language"], second["page"]) == ("player1", "Часы спешат", None, None)


def test_feedback_statuses(client, token_user_1, moderator):
    _, mod_token = moderator
    first = client.post(f"{API}/feedback", json=REPORT).json()["id"]
    second = client.post(f"{API}/feedback", json={**REPORT, "message": "Второе сообщение"}).json()["id"]
    url = f"{API}/feedback/{first}/status"
    assert client.post(url, json={"status": "done"}, headers=auth(token_user_1)).status_code == 403
    assert client.post(url, json={"status": "fixed"}, headers=auth(mod_token)).status_code == 422
    missing = client.post(f"{API}/feedback/999/status", json={"status": "done"}, headers=auth(mod_token))
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "feedback_not_found"

    started = client.post(url, json={"status": "in_progress"}, headers=auth(mod_token))
    assert started.json() == {"id": first, "status": "in_progress"}
    closed = client.post(f"{API}/feedback/{second}/status", json={"status": "rejected"}, headers=auth(mod_token))
    assert closed.status_code == 200
    # Очередь по умолчанию — неразобранное; закрытое видно по своему статусу.
    queue = client.get(f"{API}/feedback", headers=auth(mod_token)).json()
    assert [item["id"] for item in queue["items"]] == [first]
    assert queue["counts"] == {"new": 0, "in_progress": 1, "done": 0, "rejected": 1}
    rejected = client.get(f"{API}/feedback", params={"status": "rejected"}, headers=auth(mod_token)).json()["items"]
    assert [(item["id"], item["updated_at"] is not None) for item in rejected] == [(second, True)]
    assert client.get(f"{API}/feedback", params={"status": "bogus"}, headers=auth(mod_token)).status_code == 422


@pytest.mark.parametrize("body", [
    {"message": "мало"},  # короче 5 знаков
    {"message": "x" * 2001},
    {"message": "Обычный текст", "screen": "wide"},
    {"message": "Обычный текст", "page": "/" + "p" * 200},
    {},
])
def test_feedback_is_validated(client, body):
    assert client.post(f"{API}/feedback", json=body).status_code == 422


def test_feedback_of_spaces_only_is_refused(client):
    refused = client.post(f"{API}/feedback", json={"message": "          "})
    assert refused.status_code == 400 and refused.json()["detail"]["code"] == "feedback_invalid"


def test_feedback_is_rate_limited(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK", 2)
    for _ in range(2):
        assert client.post(f"{API}/feedback", json=REPORT).status_code == 201
    blocked = client.post(f"{API}/feedback", json=REPORT)
    assert blocked.status_code == 429 and blocked.json()["detail"]["code"] == "too_many_feedback"
    assert blocked.json()["detail"]["params"]["retry_after"] > 0


# --- сводка за неделю ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("page", "section"), [
    ("/puzzles/42?theme=fork", "/puzzles"), ("/", "/"), ("/learn/course#top", "/learn"), (None, "?"), ("puzzles", "?"),
])
def test_page_section(page, section):
    assert beta.page_section(page) == section


async def test_weekly_digest(db_session, test_user_1):
    from scripts.feedback_digest import render

    until = datetime(2026, 11, 16, tzinfo=UTC)
    since = until - timedelta(days=7)

    def item(days_ago: float, message: str, status: str = "new", page: str | None = "/puzzles/1", user_id: int | None = None):
        return Feedback(message=message, status=status, page=page, user_id=user_id, app_version="1.2.2", language="ru",
                        screen="390x844", created_at=until - timedelta(days=days_ago))

    db_session.add_all([
        item(1, "Задача не засчитана\nхотя ход верный", user_id=test_user_1.id),
        item(2, "Часы спешат", status="done", page="/"),
        item(3, "Не грузится доска", status="in_progress", page="/puzzles/7?x=1"),
        item(6.5, "Спам", status="rejected", page=None),
        item(9, "Старое, но не разобрано"),          # раньше периода — только в остатке
        item(-1, "Из следующей недели"),             # позже периода
        Invite(code="AAAAAAAAAA", uses=3, max_uses=5),
        Invite(code="BBBBBBBBBB", uses=2, revoked_at=until),
    ])
    await db_session.commit()

    digest = await beta.build_digest(db_session, since, until)
    assert [entry.message.split("\n")[0] for entry in digest.items] == [
        "Спам", "Не грузится доска", "Часы спешат", "Задача не засчитана"]
    assert digest.by_status == {"new": 1, "in_progress": 1, "done": 1, "rejected": 1}
    assert digest.by_page == [("/puzzles", 2), ("/", 1), ("?", 1)]
    assert (digest.backlog, digest.invited, digest.active_invites) == (3, 5, 1)

    text = render(digest)
    assert text.startswith("### Отзывы беты: 09.11 – 15.11.2026")
    assert "* Пришло 4: новых 1, в работе 1, сделано 1, отклонено 1. Неразобранных всего: 3." in text
    assert "* По разделам: `/puzzles` — 2, `/` — 1, без страницы — 1." in text
    assert "* Приглашения: по кодам пришло 5, действующих кодов 1." in text
    # Открытые сообщения — пунктами с галочкой, текст в одну строку; закрытые — отдельным списком.
    newest = digest.items[3].id
    assert f"- [ ] #{newest} `/puzzles/1` — Задача не засчитана / хотя ход верный (player1, ru, 390x844, v1.2.2)" in text
    assert f"- [x] #{digest.items[2].id} `/` — Часы спешат" in text
    assert "Спам" in text and "Старое" not in text and "следующей" not in text


async def test_empty_digest(db_session):
    from scripts.feedback_digest import render

    until = datetime(2026, 11, 16, tzinfo=UTC)
    text = render(await beta.build_digest(db_session, until - timedelta(days=7), until))
    assert "* Сообщений за неделю не было." in text
