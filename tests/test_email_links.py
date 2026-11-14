# --- FILE: tests/test_email_links.py ---
"""E-mail и сброс пароля по ссылке (таск 17.5): письма перехватываются, ссылки одноразовые и с истечением."""

import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from src.core.security import get_password_hash
from src.models.email_token import EmailToken
from src.models.user import User
from src.services import mailer

API = "/api/v1/account"
PASSWORD = "secret-pass-1"


@pytest.fixture
def outbox(monkeypatch):
    """Письма вместо SMTP: (кому, тема, текст)."""
    sent: list[tuple[str, str, str]] = []

    async def capture(to, subject, body):
        sent.append((to, subject, body))

    monkeypatch.setattr(mailer, "send", capture)
    return sent


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def link_token(body: str) -> str:
    return re.search(r"token=([\w-]+)", body).group(1)


async def with_password(db_session, user: User) -> None:
    user.hashed_password = get_password_hash(PASSWORD)
    await db_session.commit()


async def verified(client, db_session, user, token, outbox, email="alice@example.com") -> None:
    await with_password(db_session, user)
    assert client.post(f"{API}/email", headers=auth(token),
                       json={"email": email, "password": PASSWORD, "language": "uk"}).status_code == 202
    assert client.post(f"{API}/email/verify", json={"token": link_token(outbox[-1][2])}).status_code == 200


async def test_email_is_linked_only_after_the_link(client, db_session, test_user_1, token_user_1, outbox):
    await with_password(db_session, test_user_1)
    response = client.post(f"{API}/email", headers=auth(token_user_1),
                           json={"email": "Alice@Example.com", "password": PASSWORD, "language": "uk"})
    assert response.status_code == 202
    to, subject, body = outbox[-1]
    assert to == "alice@example.com" and subject == "Підтвердіть e-mail для michess" and "/verify-email?token=" in body
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()["email"] is None

    token = link_token(body)
    assert client.post(f"{API}/email/verify", json={"token": token}).json() == {"email": "alice@example.com"}
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()["email"] == "alice@example.com"
    # Ссылка одноразовая.
    again = client.post(f"{API}/email/verify", json={"token": token})
    assert again.status_code == 400 and again.json()["detail"]["code"] == "email_link_invalid"


async def test_email_needs_password_and_cannot_be_taken_twice(
        client, db_session, test_user_1, token_user_1, test_user_2, token_user_2, outbox):
    await verified(client, db_session, test_user_1, token_user_1, outbox)
    await with_password(db_session, test_user_2)
    wrong = client.post(f"{API}/email", headers=auth(token_user_2),
                        json={"email": "bob@example.com", "password": "nope-nope"})
    assert wrong.status_code == 400
    taken = client.post(f"{API}/email", headers=auth(token_user_2),
                        json={"email": "ALICE@example.com", "password": PASSWORD})
    assert taken.status_code == 409 and taken.json()["detail"]["code"] == "email_taken"


async def test_password_reset_by_link(client, db_session, test_user_1, token_user_1, outbox):
    await verified(client, db_session, test_user_1, token_user_1, outbox)
    assert client.post(f"{API}/password-reset", json={"email": "alice@example.com", "language": "ru"}).status_code == 202
    to, subject, body = outbox[-1]
    assert subject == "Сброс пароля michess" and "/reset-password?token=" in body
    token = link_token(body)

    assert client.post(f"{API}/password-reset/confirm",
                       json={"token": token, "new_password": "brand-new-pass"}).status_code == 204
    # Старые сессии отозваны, новый пароль входит, ссылка второй раз не работает.
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).status_code == 401
    login = client.post("/api/v1/auth/login", data={"username": test_user_1.username, "password": "brand-new-pass"})
    assert login.status_code == 200
    reused = client.post(f"{API}/password-reset/confirm", json={"token": token, "new_password": "another-pass-1"})
    assert reused.status_code == 400


async def test_reset_answer_does_not_reveal_unknown_addresses(client, outbox):
    response = client.post(f"{API}/password-reset", json={"email": "nobody@example.com"})
    assert response.status_code == 202 and outbox == []


async def test_expired_reset_link_is_rejected(client, db_session, test_user_1, token_user_1, outbox):
    await verified(client, db_session, test_user_1, token_user_1, outbox)
    client.post(f"{API}/password-reset", json={"email": "alice@example.com"})
    token = link_token(outbox[-1][2])
    await db_session.execute(update(EmailToken).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    await db_session.commit()
    expired = client.post(f"{API}/password-reset/confirm", json={"token": token, "new_password": "brand-new-pass"})
    assert expired.status_code == 400 and expired.json()["detail"]["code"] == "email_link_invalid"


async def test_letters_per_address_are_limited(client, monkeypatch, outbox, freeze_rate_limit_window):
    from src.core.config import settings

    monkeypatch.setattr(settings, "RATE_LIMIT_EMAIL_PER_ADDRESS", 2)
    for _ in range(2):
        assert client.post(f"{API}/password-reset", json={"email": "victim@example.com"}).status_code == 202
    blocked = client.post(f"{API}/password-reset", json={"email": "victim@example.com"})
    assert blocked.status_code == 429 and blocked.json()["detail"]["code"] == "too_many_emails"


def test_bad_address_is_rejected(client):
    assert client.post(f"{API}/password-reset", json={"email": "not-an-address"}).status_code == 422


async def test_mail_goes_to_the_log_without_smtp(caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="src.services.mailer"):
        await mailer.send("a@example.com", "Subject", "Body with link")
    assert "Body with link" in caplog.text
