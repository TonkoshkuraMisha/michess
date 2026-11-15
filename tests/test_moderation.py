# --- FILE: tests/test_moderation.py ---
"""Модерация (таск 17.4): жалобы, очередь модератора, решения, отключённый чат, проверка флага и апелляция."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.moderation import Report
from src.models.social import Notification
from src.models.user import User
from src.services import moderation

API = "/api/v1/moderation"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def moderator(db_session):
    from src.core.security import create_user_token

    user = User(username="mod", hashed_password="x", is_moderator=True)
    db_session.add(user)
    await db_session.commit()
    return user, create_user_token(user)


async def test_report_queue_and_chat_ban(client, db_session, token_user_1, token_user_2, test_user_1, test_user_2, moderator):
    mod, mod_token = moderator
    body = {"target": "PLAYER2", "kind": "message", "reason": "abuse", "comment": "грубит", "message_text": "ты слабак"}
    assert client.post(f"{API}/reports", json=body, headers=auth(token_user_1)).status_code == 201
    again = client.post(f"{API}/reports", json=body, headers=auth(token_user_1))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "report_duplicate"
    self_report = client.post(f"{API}/reports", json={**body, "target": "player1"}, headers=auth(token_user_1))
    assert self_report.json()["detail"]["code"] == "report_self"

    assert client.get(f"{API}/queue", headers=auth(token_user_1)).status_code == 403
    queue = client.get(f"{API}/queue", headers=auth(mod_token)).json()["reports"]
    assert [(r["reporter"], r["target"], r["message_text"], r["reports_on_target"]) for r in queue] == [
        ("player1", "player2", "ты слабак", 1)]

    resolved = client.post(f"{API}/reports/{queue[0]['id']}/resolve", json={"action": "chat_ban"}, headers=auth(mod_token))
    assert resolved.json() == {"id": queue[0]["id"], "action": "chat_ban"}
    await db_session.refresh(test_user_2)
    assert moderation.chat_banned(test_user_2)
    status = client.get(f"{API}/me", headers=auth(token_user_2)).json()
    assert status["chat_banned_until"] is not None and status["is_moderator"] is False
    # Автор жалобы получил «ответ на жалобу».
    notes = (await db_session.execute(select(Notification).where(Notification.user_id == test_user_1.id))).scalars().all()
    assert [(n.kind, n.payload["action"]) for n in notes] == [("report_answer", "chat_ban")]
    assert client.post(f"{API}/reports/{queue[0]['id']}/resolve", json={"action": "dismiss"},
                       headers=auth(mod_token)).status_code == 404


def test_chat_ban_expires():
    user = User(username="x", hashed_password="x", chat_banned_until=datetime.now(UTC) - timedelta(minutes=1))
    assert moderation.chat_banned(user) is False
    user.chat_banned_until = datetime.now(UTC) + timedelta(hours=1)
    assert moderation.chat_banned(user) is True


async def test_auto_flag_review_and_appeal(client, db_session, test_user_1, token_user_1, moderator):
    mod, mod_token = moderator
    await moderation.flag_for_review(db_session, test_user_1, None)
    await moderation.flag_for_review(db_session, test_user_1, None)    # вторая заявка не дублируется
    test_user_1.is_cheater = True
    test_user_1.trust_factor = 20
    await db_session.commit()
    reviews = (await db_session.execute(select(Report).where(Report.kind == "cheat_review"))).scalars().all()
    assert len(reviews) == 1 and reviews[0].reporter_id is None

    assert client.post(f"{API}/appeal", json={"comment": "играл сам"}, headers=auth(token_user_1)).status_code == 201
    assert client.get(f"{API}/me", headers=auth(token_user_1)).json()["open_appeal"] is True
    queue = client.get(f"{API}/queue", headers=auth(mod_token)).json()["reports"]
    assert {r["kind"] for r in queue} == {"cheat_review", "appeal"}
    appeal_id = next(r["id"] for r in queue if r["kind"] == "appeal")
    client.post(f"{API}/reports/{appeal_id}/resolve", json={"action": "clear_cheater"}, headers=auth(mod_token))
    await db_session.refresh(test_user_1)
    assert test_user_1.is_cheater is False and test_user_1.trust_factor == 100
    # Заявка автоматики по тому же флагу закрыта тем же решением.
    assert client.get(f"{API}/queue", headers=auth(mod_token)).json()["reports"] == []
    again = client.post(f"{API}/appeal", json={}, headers=auth(token_user_1))
    assert again.json()["detail"]["code"] == "appeal_not_flagged"


async def test_anticheat_flag_creates_review(db_session):
    """Настоящий путь: телеметрия партии → флаг автоматики → заявка в очередь модератора."""
    from src.models.game import Game, GameStatus
    from src.services.game_state import state_manager

    cheater = User(username="ac_cheater", hashed_password="pw", trust_factor=100, is_cheater=False)
    other = User(username="ac_other", hashed_password="pw", trust_factor=100, is_cheater=False)
    db_session.add_all([cheater, other])
    await db_session.commit()
    game = Game(white_player_id=cheater.id, black_player_id=other.id, status=GameStatus.IN_PROGRESS,
                base_time_ms=180000, increment_ms=0, is_rated=True)
    db_session.add(game)
    await db_session.commit()
    await state_manager.initialize_game(game.id, cheater.id, other.id, 180000, 0)
    for idx, uci in enumerate(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3", "g8f6", "b1c3", "d7d6"], start=1):
        await state_manager.save_move_telemetry(game.id, {
            "player_id": cheater.id if idx % 2 == 1 else other.id, "move_number": idx, "notation": uci,
            "san": uci[:2] + "-" + uci[2:], "fen_after": "", "time_taken_ms": 4500,
            "window_blurred_before_move": True, "is_premove": False, "network_lag_ms": 5,
        })
    await state_manager.finish_game(db_session, game.id, "1-0", termination="checkmate")
    await db_session.refresh(cheater)
    await db_session.refresh(other)
    assert cheater.is_cheater is True
    # Заявка — на каждого, кого пометила автоматика (по одной), с партией, по которой пометила.
    flagged = {u.id for u in (cheater, other) if u.is_cheater}
    reviews = (await db_session.execute(select(Report).where(Report.kind == "cheat_review"))).scalars().all()
    assert {r.target_id for r in reviews} == flagged and len(reviews) == len(flagged)
    assert {r.game_id for r in reviews} == {game.id}


async def test_language_settings_and_translation_suggestion(client, db_session, token_user_1, test_user_1, moderator):
    """Таск 17.7: язык в профиле, режим «помощник перевода», предложение исправления — в очередь модерации."""
    _, mod_token = moderator
    me = client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()
    assert me["language"] is None and me["translation_helper"] is False

    body = {"language": "uk", "key": "chat.title", "current": "Чат", "suggestion": "Розмова", "context": "/play"}
    off = client.post(f"{API}/translations", json=body, headers=auth(token_user_1))
    assert off.status_code == 403 and off.json()["detail"]["code"] == "translation_helper_off"

    saved = client.patch("/api/v1/profile/me/settings", json={"language": "uk", "translation_helper": True},
                         headers=auth(token_user_1))
    assert saved.json() == {"language": "uk", "translation_helper": True, "theme_preset": None}
    assert client.patch("/api/v1/profile/me/settings", json={"language": "de"}, headers=auth(token_user_1)).status_code == 422
    me = client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()
    assert (me["language"], me["translation_helper"]) == ("uk", True)

    assert client.post(f"{API}/translations", json=body, headers=auth(token_user_1)).status_code == 201
    assert client.post(f"{API}/translations", json=body, headers=auth(token_user_1)).status_code == 409
    queue = client.get(f"{API}/queue", headers=auth(mod_token)).json()["reports"]
    assert [(r["kind"], r["subject"], r["context"], r["message_text"], r["comment"]) for r in queue] == [
        ("translation", "uk:chat.title", "/play", "Чат", "Розмова")]
    done = client.post(f"{API}/reports/{queue[0]['id']}/resolve", json={"action": "accept"}, headers=auth(mod_token))
    assert done.json()["action"] == "accept"


def test_theme_preset_in_profile(client, token_user_1):
    """Таск 18.3: тема-комплект хранится в профиле."""
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()["theme_preset"] is None
    saved = client.patch("/api/v1/profile/me/settings", json={"theme_preset": "marble_hall"}, headers=auth(token_user_1))
    assert saved.json()["theme_preset"] == "marble_hall"
    assert client.get("/api/v1/profile/me", headers=auth(token_user_1)).json()["theme_preset"] == "marble_hall"
    bad = client.patch("/api/v1/profile/me/settings", json={"theme_preset": "<script>"}, headers=auth(token_user_1))
    assert bad.status_code == 422
