"""Согласие с условиями при регистрации (таск 23.1): путь клиента — POST /auth/register — и чистые правила legal.py."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from src.core.config import settings
from src.core.errors import ApiError
from src.models.user import User
from src.services import legal

REGISTER = "/api/v1/auth/register"


@pytest.fixture
def consent_required(monkeypatch):
    monkeypatch.setattr(settings, "REQUIRE_TERMS_CONSENT", True)


def test_registration_without_consent_is_refused(client, consent_required):
    res = client.post(REGISTER, json={"username": "NoConsent", "password": "secret123"})
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "terms_not_accepted"


@pytest.mark.asyncio
async def test_registration_with_consent_records_version_and_time(client, db_session, consent_required):
    res = client.post(REGISTER, json={"username": "Agreed", "password": "secret123", "accept_terms": True})
    assert res.status_code == 201
    user = (await db_session.execute(select(User).where(User.username == "Agreed"))).scalar_one()
    assert user.terms_version == legal.TERMS_VERSION
    assert user.terms_accepted_at is not None


def test_consent_check_can_be_switched_off(client):
    """Тестовый стенд (REQUIRE_TERMS_CONSENT=false): регистрация без отметки проходит."""
    assert client.post(REGISTER, json={"username": "Relaxed", "password": "secret123"}).status_code == 201


def test_require_consent_rules():
    legal.require_consent(True, True)
    legal.require_consent(False, False)
    with pytest.raises(ApiError) as err:
        legal.require_consent(False, True)
    assert err.value.detail["code"] == "terms_not_accepted"


def test_record_consent_is_empty_without_acceptance():
    user = User(username="x", hashed_password="h")
    legal.record_consent(user, False)
    assert user.terms_version is None and user.terms_accepted_at is None
    stamp = datetime(2026, 11, 21, tzinfo=UTC)
    legal.record_consent(user, True, now=stamp)
    assert (user.terms_version, user.terms_accepted_at) == (legal.TERMS_VERSION, stamp)
