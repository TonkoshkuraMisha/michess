# --- FILE: tests/test_social.py ---
"""Игроки и уведомления (таск 17.1): поиск, подписки и «друзья», вызов через приглашение, центр уведомлений."""

from sqlalchemy import select

from src.models.social import Notification
from src.models.tournament import Tournament
from src.models.user import User
from src.services import notifications
from src.services import tournaments as tournament_service
from src.services.matchmaker import matchmaker
from tests.test_tournaments import body, play

API = "/api/v1/social"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_search_finds_real_players_only(client, token_user_1, test_user_2, db_session):
    db_session.add_all([User(username="player_archive", hashed_password="!historical_archive_no_login!"),
                        User(username="player_bot", hashed_password="x", is_bot=True),
                        User(username="Player22", hashed_password="x")])
    await db_session.commit()
    found = client.get(f"{API}/search", params={"q": "PLAY"}, headers=auth(token_user_1)).json()["players"]
    assert [p["username"] for p in found] == ["player2", "Player22"]   # сначала короче; без себя, ботов и архива
    assert found[0]["online"] is False
    assert client.get(f"{API}/search", params={"q": "p"}, headers=auth(token_user_1)).status_code == 422


async def test_follow_unfollow_and_friends(client, token_user_1, token_user_2):
    first = client.post(f"{API}/follow/PLAYER2", headers=auth(token_user_1)).json()
    assert (first["following"], first["followed_by"], first["friends"]) == (True, False, False)
    assert client.post(f"{API}/follow/player2", headers=auth(token_user_1)).status_code == 200   # повтор — не ошибка
    client.post(f"{API}/follow/player1", headers=auth(token_user_2))
    assert client.get(f"{API}/relation/player2", headers=auth(token_user_1)).json()["friends"] is True
    following = client.get(f"{API}/following", headers=auth(token_user_1)).json()["players"]
    assert [(p["username"], p["friend"]) for p in following] == [("player2", True)]
    after = client.delete(f"{API}/follow/player2", headers=auth(token_user_1)).json()
    assert after["following"] is False and after["followed_by"] is True
    me = client.post(f"{API}/follow/player1", headers=auth(token_user_1))
    assert me.status_code == 400 and me.json()["detail"]["code"] == "cannot_follow_self"
    assert client.post(f"{API}/follow/nobody", headers=auth(token_user_1)).status_code == 404


async def test_challenge_becomes_a_notification(client, token_user_1, token_user_2, test_user_1):
    invite = await matchmaker.create_private_invite(test_user_1.id, "player1", 1200, 300_000, 2_000, "random", True)
    sent = client.post(f"{API}/challenge/player2", json={"code": invite["code"]}, headers=auth(token_user_1))
    assert sent.status_code == 200 and sent.json()["sent"] is True
    inbox = client.get(f"{API}/notifications", headers=auth(token_user_2)).json()
    assert inbox["unread"] == 1
    note = inbox["items"][0]
    assert note["kind"] == "challenge" and note["payload"]["from"] == "player1" and note["payload"]["code"] == invite["code"]
    assert note["payload"]["base_time_ms"] == 300_000 and note["read"] is False
    read = client.post(f"{API}/notifications/read", json={}, headers=auth(token_user_2)).json()
    assert read["unread"] == 0 and read["items"][0]["read"] is True


async def test_foreign_or_missing_invite_is_rejected(client, token_user_1, token_user_2, test_user_2):
    others = await matchmaker.create_private_invite(test_user_2.id, "player2", 1200)
    foreign = client.post(f"{API}/challenge/player2", json={"code": others["code"]}, headers=auth(token_user_1))
    assert foreign.status_code == 404 and foreign.json()["detail"]["code"] == "invite_invalid"
    assert client.post(f"{API}/challenge/player2", json={"code": "zzzzzzzz"}, headers=auth(token_user_1)).status_code == 404
    self_call = client.post(f"{API}/challenge/player1", json={"code": "zzzzzzzz"}, headers=auth(token_user_1))
    assert self_call.json()["detail"]["code"] == "cannot_challenge_self"


async def test_notifications_are_private_and_marked_selectively(client, token_user_1, test_user_1, db_session):
    first = await notifications.record(db_session, test_user_1.id, "rematch", {"from": "x", "game_id": 1})
    await notifications.record(db_session, test_user_1.id, "rematch", {"from": "y", "game_id": 2})
    read = client.post(f"{API}/notifications/read", json={"ids": [first["id"]]}, headers=auth(token_user_1)).json()
    assert read["unread"] == 1
    assert [n["payload"]["from"] for n in read["items"]] == ["y", "x"]   # новые первыми


async def test_new_tournament_round_notifies_the_player(client, token_user_1, test_user_1, db_session):
    t = client.post("/api/v1/tournaments", headers=auth(token_user_1), json=body()).json()
    # Сыгрываем первый тур: партии бота и игрока — тур закрыт, открылся второй с партией игрока.
    tournament = await db_session.get(Tournament, t["id"])
    for game in [g for g in await tournament_service.games_of(db_session, t["id"]) if g.round == 1]:
        await tournament_service.record_result(db_session, tournament, game, "1-0")
    rows = (await db_session.execute(select(Notification).where(Notification.user_id == test_user_1.id))).scalars().all()
    assert [(n.kind, n.payload["round"]) for n in rows] == [("tournament_round", 2)]
    await play(db_session, t["id"], lambda g: "1/2-1/2")
    rows = (await db_session.execute(select(Notification).where(Notification.user_id == test_user_1.id))).scalars().all()
    assert [n.payload["round"] for n in rows] == [2, 3]
