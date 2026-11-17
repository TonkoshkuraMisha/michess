# --- FILE: tests/test_direct_messages.py ---
"""Личные сообщения (таск 30.1): переписка, карточки-вложения, кто может писать, чёрный список, доставка."""

from datetime import UTC, datetime, timedelta

from src.models.game import Game, GameStatus
from src.models.puzzle import Puzzle
from src.services import direct_messages as dm

API = "/api/v1/messages"
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_conversation_unread_and_read(client, token_user_1, token_user_2, monkeypatch):
    delivered = []

    async def fake_deliver(message, sender_name):
        delivered.append((message.recipient_id, sender_name, message.body))

    monkeypatch.setattr(dm, "deliver", fake_deliver)
    first = client.post(f"{API}/with/PLAYER2", json={"body": "  Привет!\n\n\n\nСыграем?  "}, headers=auth(token_user_1))
    assert first.status_code == 200
    assert first.json()["mine"] is True and first.json()["body"] == "Привет!\n\nСыграем?"
    client.post(f"{API}/with/player1", json={"body": "Давай"}, headers=auth(token_user_2))
    client.post(f"{API}/with/player1", json={"body": "5+3?"}, headers=auth(token_user_2))
    assert [d[1] for d in delivered] == ["player1", "player2", "player2"]

    inbox = client.get(API, headers=auth(token_user_1)).json()
    assert inbox["unread"] == 2
    [talk] = inbox["conversations"]
    assert (talk["username"], talk["unread"], talk["last"]["body"], talk["last"]["mine"]) == ("player2", 2, "5+3?", False)

    thread = client.get(f"{API}/with/player2", headers=auth(token_user_1)).json()
    assert [(m["body"], m["mine"]) for m in thread["messages"]] == [
        ("Привет!\n\nСыграем?", True), ("Давай", False), ("5+3?", False)]
    assert thread["can_write"] is True and thread["reason"] is None
    assert client.post(f"{API}/with/player2/read", headers=auth(token_user_1)).json() == {"unread": 0}
    # Прочитанное мной не делает прочитанным моё сообщение у собеседника.
    assert client.get(f"{API}/unread", headers=auth(token_user_2)).json() == {"unread": 1}


async def test_empty_self_and_paging(client, token_user_1, token_user_2, monkeypatch):
    monkeypatch.setattr(dm, "PAGE", 2)
    empty = client.post(f"{API}/with/player2", json={"body": "   \n "}, headers=auth(token_user_1))
    assert empty.status_code == 400 and empty.json()["detail"]["code"] == "dm_empty"
    me = client.post(f"{API}/with/player1", json={"body": "hi"}, headers=auth(token_user_1))
    assert me.json()["detail"]["code"] == "cannot_message_self"
    assert client.post(f"{API}/with/nobody", json={"body": "hi"}, headers=auth(token_user_1)).status_code == 404
    for text in ("1", "2", "3"):
        client.post(f"{API}/with/player2", json={"body": text}, headers=auth(token_user_1))
    page = client.get(f"{API}/with/player2", headers=auth(token_user_1)).json()["messages"]
    assert [m["body"] for m in page] == ["2", "3"]
    earlier = client.get(f"{API}/with/player2", params={"before_id": page[0]["id"]}, headers=auth(token_user_1)).json()
    assert [m["body"] for m in earlier["messages"]] == ["1"]


async def test_attachments_are_cards(client, token_user_1, test_user_1, test_user_2, db_session):
    game = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED,
                result="1-0")
    puzzle = Puzzle(source="test", source_id="t1", fen=START, moves="e2e4", rating=1450)
    db_session.add_all([game, puzzle])
    await db_session.commit()

    def send(kind: str, ref: str, body: str = ""):
        return client.post(f"{API}/with/player2", json={"body": body, "attachment": {"kind": kind, "ref": ref}},
                           headers=auth(token_user_1))

    card = send("game", str(game.id), "Смотри").json()["attachment"]
    assert card == {"kind": "game", "ref": str(game.id), "white": "player1", "black": "player2", "result": "1-0",
                    "status": "COMPLETED"}
    assert send("puzzle", str(puzzle.id)).json()["attachment"] == {"kind": "puzzle", "ref": str(puzzle.id),
                                                                   "fen": START, "rating": 1450}
    assert send("position", START).json()["attachment"] == {"kind": "position", "ref": START}
    assert send("lesson", "fork-basics").json()["attachment"] == {"kind": "lesson", "ref": "fork-basics"}
    for kind, ref in (("game", "999999"), ("game", "abc"), ("position", "not a fen"),
                      ("position", "8/8/8/8/8/8/8/8 w - - 0 1"), ("lesson", "../etc"), ("tournament", "424242")):
        bad = send(kind, ref)
        assert bad.status_code == 400 and bad.json()["detail"]["code"] == "dm_attachment_invalid", (kind, ref)
    assert send("video", "1").status_code == 422


async def test_policy_following_and_nobody(client, token_user_1, token_user_2):
    put = client.put(f"{API}/settings", json={"dm_policy": "following"}, headers=auth(token_user_2))
    assert put.json() == {"dm_policy": "following", "blocked": []}
    closed = client.post(f"{API}/with/player2", json={"body": "hi"}, headers=auth(token_user_1))
    assert closed.status_code == 403 and closed.json()["detail"]["code"] == "dm_closed"
    view = client.get(f"{API}/with/player2", headers=auth(token_user_1)).json()
    assert (view["can_write"], view["reason"]) == (False, "dm_closed")
    client.post("/api/v1/social/follow/player1", headers=auth(token_user_2))     # player2 подписан на player1
    assert client.post(f"{API}/with/player2", json={"body": "hi"}, headers=auth(token_user_1)).status_code == 200
    client.put(f"{API}/settings", json={"dm_policy": "nobody"}, headers=auth(token_user_2))
    assert client.post(f"{API}/with/player2", json={"body": "hi"}, headers=auth(token_user_1)).status_code == 403
    assert client.put(f"{API}/settings", json={"dm_policy": "friends"}, headers=auth(token_user_2)).status_code == 422


async def test_block_both_ways(client, token_user_1, token_user_2):
    client.post(f"{API}/with/player1", json={"body": "spam"}, headers=auth(token_user_2))
    blocked = client.post(f"{API}/block/player2", headers=auth(token_user_1)).json()
    assert blocked["blocked"] == ["player2"]
    assert client.post(f"{API}/block/player1", headers=auth(token_user_1)).json()["detail"]["code"] == "cannot_block_self"
    them = client.post(f"{API}/with/player1", json={"body": "spam"}, headers=auth(token_user_2))
    assert them.status_code == 403 and them.json()["detail"]["code"] == "dm_closed"   # не раскрываем, что заблокирован
    me = client.post(f"{API}/with/player2", json={"body": "hi"}, headers=auth(token_user_1))
    assert me.json()["detail"]["code"] == "dm_you_blocked"
    [talk] = client.get(API, headers=auth(token_user_1)).json()["conversations"]
    assert talk["blocked"] is True
    assert client.delete(f"{API}/block/player2", headers=auth(token_user_1)).json()["blocked"] == []
    assert client.post(f"{API}/with/player1", json={"body": "ok"}, headers=auth(token_user_2)).status_code == 200


async def test_chat_ban_stops_messages(client, token_user_1, test_user_1, test_user_2, db_session):
    test_user_1.chat_banned_until = datetime.now(UTC) + timedelta(hours=1)
    await db_session.commit()
    banned = client.post(f"{API}/with/player2", json={"body": "hi"}, headers=auth(token_user_1))
    assert banned.status_code == 403 and banned.json()["detail"]["code"] == "dm_chat_banned"


async def test_messages_need_login(client):
    assert client.get(API).status_code == 401
