# --- FILE: tests/test_civility.py ---
"""Уважительное общение (таск 30.3): фильтр до отправки, придержание до модератора, жалоба на текст в один шаг,
ограничения новичкам и нарушителям, скрытие переписки."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.moderation import Report
from src.models.social import DirectMessage, Post
from src.models.user import User
from src.services import civility

MSG = "/api/v1/messages"
FEED = "/api/v1/feed"
MOD = "/api/v1/moderation"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def moderator(db_session):
    from src.core.security import create_user_token

    user = User(username="mod", hashed_password="x", is_moderator=True)
    db_session.add(user)
    await db_session.commit()
    return create_user_token(user)


@pytest.fixture(autouse=True)
async def veterans(db_session, test_user_1, test_user_2):
    """Тестовые игроки «старые», чтобы ограничения новичков не мешали остальным проверкам."""
    for user in (test_user_1, test_user_2):
        user.created_at = datetime.now(UTC) - timedelta(days=30)
    await db_session.commit()


@pytest.mark.parametrize("text", [
    "ты идиот", "Ты ИДИОООТ!", "ид1от", "you are an idiot", "f*ck off".replace("*", "u"), "иди нахуй",
    "кил yourself".replace("кил", "kill"), "ти ідіот", "дeбил",  # латинская «e» в кириллическом слове
    "убей себя",
])
def test_offensive_texts(text):
    assert civility.offensive(text) is True


@pytest.mark.parametrize("text", [
    "Отличная партия!", "колебание в эндшпиле", "застрахуй ладью", "Great game, well played", "лохматый конь",
    "assess the position", "Scunthorpe", "уродился же такой ход", "",
])
def test_harmless_texts(text):
    assert civility.offensive(text) is False


async def test_dm_flagged_then_held_until_released(client, token_user_1, token_user_2, moderator, db_session):
    flagged = client.post(f"{MSG}/with/player2", json={"body": "ты идиот"}, headers=auth(token_user_1))
    assert flagged.status_code == 409 and flagged.json()["detail"]["code"] == "text_flagged"
    sent = client.post(f"{MSG}/with/player2", json={"body": "ты идиот", "send_anyway": True}, headers=auth(token_user_1))
    assert sent.status_code == 200 and sent.json()["held"] is True
    # Отправитель видит своё придержанное, получатель — нет (и не считает непрочитанным).
    assert [m["held"] for m in client.get(f"{MSG}/with/player2", headers=auth(token_user_1)).json()["messages"]] == [True]
    assert client.get(f"{MSG}/with/player1", headers=auth(token_user_2)).json()["messages"] == []
    assert client.get(f"{MSG}/unread", headers=auth(token_user_2)).json() == {"unread": 0}

    queue = client.get(f"{MOD}/queue", headers=auth(moderator)).json()["reports"]
    assert [(r["kind"], r["subject"], r["message_text"], r["target"]) for r in queue] == [
        ("held", f"dm:{sent.json()['id']}", "ты идиот", "player1")]
    client.post(f"{MOD}/reports/{queue[0]['id']}/resolve", json={"action": "release"}, headers=auth(moderator))
    released = client.get(f"{MSG}/with/player1", headers=auth(token_user_2)).json()["messages"]
    assert [m["body"] for m in released] == ["ты идиот"]


async def test_held_post_and_comment_then_hidden(client, token_user_1, token_user_2, moderator, db_session):
    refused = client.post(FEED, json={"body": "все дебилы"}, headers=auth(token_user_1))
    assert refused.json()["detail"]["code"] == "text_flagged"
    held = client.post(FEED, json={"body": "все дебилы", "send_anyway": True}, headers=auth(token_user_1)).json()
    assert held["held"] is True
    assert client.get(f"{FEED}/user/player1").json()["posts"] == []           # чужим не видно
    assert [p["held"] for p in client.get(f"{FEED}/user/player1", headers=auth(token_user_1)).json()["posts"]] == [True]

    post_id = client.post(FEED, json={"body": "Красивый этюд"}, headers=auth(token_user_1)).json()["id"]
    comment = client.post(f"{FEED}/posts/{post_id}/comments", json={"body": "сука", "send_anyway": True},
                          headers=auth(token_user_2)).json()
    assert comment["held"] is True
    assert client.get(f"{FEED}/posts/{post_id}", headers=auth(token_user_1)).json()["comments"] == []

    queue = client.get(f"{MOD}/queue", headers=auth(moderator)).json()["reports"]
    assert sorted(r["subject"] for r in queue) == sorted([f"post:{held['id']}", f"comment:{comment['id']}"])
    for report in queue:
        client.post(f"{MOD}/reports/{report['id']}/resolve", json={"action": "hide"}, headers=auth(moderator))
    post = await db_session.get(Post, held["id"])
    await db_session.refresh(post)
    assert post.hidden_at is not None and post.held is False
    assert client.get(f"{FEED}/posts/{post_id}", headers=auth(token_user_2)).json()["comments"] == []


async def test_text_report_in_one_step(client, token_user_1, token_user_2, moderator, db_session):
    message = client.post(f"{MSG}/with/player2", json={"body": "отдай партию"}, headers=auth(token_user_1)).json()
    subject = f"dm:{message['id']}"
    own = client.post(f"{MOD}/reports/text", json={"subject": subject}, headers=auth(token_user_1))
    assert own.json()["detail"]["code"] == "report_self"
    created = client.post(f"{MOD}/reports/text", json={"subject": subject, "reason": "spam"}, headers=auth(token_user_2))
    assert created.status_code == 201
    again = client.post(f"{MOD}/reports/text", json={"subject": subject}, headers=auth(token_user_2))
    assert again.status_code == 409
    bad = client.post(f"{MOD}/reports/text", json={"subject": "game:1"}, headers=auth(token_user_2))
    assert bad.status_code == 422
    [report] = (await db_session.execute(select(Report).where(Report.kind == "content"))).scalars().all()
    assert (report.subject, report.message_text, report.reason) == (subject, "отдай партию", "spam")

    queue = client.get(f"{MOD}/queue", headers=auth(moderator)).json()["reports"]
    client.post(f"{MOD}/reports/{queue[0]['id']}/resolve", json={"action": "warn"}, headers=auth(moderator))
    assert await db_session.scalar(select(DirectMessage.id).where(DirectMessage.id == message["id"])) is None
    # После предупреждения игрок месяц под ограничением.
    user = await db_session.scalar(select(User).where(User.username == "player1"))
    assert await civility.restricted(db_session, user) is True


async def test_someone_elses_message_cannot_be_reported_by_outsider(client, token_user_1, token_user_2, db_session):
    from src.core.security import create_user_token

    outsider = User(username="player3", hashed_password="x", created_at=datetime.now(UTC) - timedelta(days=30))
    db_session.add(outsider)
    await db_session.commit()
    message = client.post(f"{MSG}/with/player2", json={"body": "привет"}, headers=auth(token_user_1)).json()
    peek = client.post(f"{MOD}/reports/text", json={"subject": f"dm:{message['id']}"},
                       headers=auth(create_user_token(outsider)))
    assert peek.status_code == 404


async def test_newcomer_quota(client, token_user_1, test_user_1, db_session, monkeypatch):
    test_user_1.created_at = datetime.now(UTC) - timedelta(hours=2)
    await db_session.commit()
    monkeypatch.setitem(civility.QUOTAS, "post", 2)
    for n in range(2):
        assert client.post(FEED, json={"body": f"#{n}"}, headers=auth(token_user_1)).status_code == 201
    limited = client.post(FEED, json={"body": "#3"}, headers=auth(token_user_1))
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "posting_limited" and limited.json()["detail"]["params"] == {"limit": 2}


async def test_hide_conversation_until_new_message(client, token_user_1, token_user_2):
    client.post(f"{MSG}/with/player1", json={"body": "1"}, headers=auth(token_user_2))
    assert client.post(f"{MSG}/with/player2/hide", headers=auth(token_user_1)).json() == {"unread": 0}
    assert client.get(MSG, headers=auth(token_user_1)).json()["conversations"] == []
    client.post(f"{MSG}/with/player1", json={"body": "2"}, headers=auth(token_user_2))
    [talk] = client.get(MSG, headers=auth(token_user_1)).json()["conversations"]
    assert (talk["last"]["body"], talk["unread"]) == ("2", 1)
