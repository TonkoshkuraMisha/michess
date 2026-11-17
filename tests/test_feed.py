# --- FILE: tests/test_feed.py ---
"""Лента и публикации (таск 30.2): лента подписок, карточки, библиотека с ограниченной видимостью, достижения,
«нравится», комментарии с уведомлением, чёрный список, скрытые и удалённые публикации."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from src.models.achievement import UserAchievement
from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.social import Notification, Post
from src.services import feed, notifications

API = "/api/v1/feed"
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def post(client, token: str, body: str = "", attachment: dict | None = None):
    return client.post(API, json={"body": body, "attachment": attachment}, headers=auth(token))


async def test_following_feed_and_profile(client, token_user_1, token_user_2, test_user_2):
    mine = post(client, token_user_1, "Мой разбор", {"kind": "position", "ref": START})
    assert mine.status_code == 201
    assert (mine.json()["author"], mine.json()["mine"], mine.json()["attachment"]["kind"]) == ("player1", True, "position")
    post(client, token_user_2, "Пост второго")
    assert [p["body"] for p in client.get(API, headers=auth(token_user_1)).json()["posts"]] == ["Мой разбор"]
    client.post("/api/v1/social/follow/player2", headers=auth(token_user_1))
    bodies = [p["body"] for p in client.get(API, headers=auth(token_user_1)).json()["posts"]]
    assert bodies == ["Пост второго", "Мой разбор"]
    # Лента игрока видна и гостю.
    guest = client.get(f"{API}/user/player2").json()["posts"]
    assert [(p["body"], p["mine"], p["liked"]) for p in guest] == [("Пост второго", False, False)]
    assert client.get(API).status_code == 401


async def test_paging(client, token_user_1, monkeypatch):
    monkeypatch.setattr(feed, "PAGE", 2)
    for n in range(3):
        post(client, token_user_1, f"#{n}")
    first = client.get(API, headers=auth(token_user_1)).json()["posts"]
    assert [p["body"] for p in first] == ["#2", "#1"]
    rest = client.get(API, params={"before_id": first[-1]["id"]}, headers=auth(token_user_1)).json()["posts"]
    assert [p["body"] for p in rest] == ["#0"]


async def test_empty_and_invalid(client, token_user_1, test_user_1, db_session):
    empty = post(client, token_user_1, "  \n ")
    assert empty.status_code == 400 and empty.json()["detail"]["code"] == "post_empty"
    bad = post(client, token_user_1, "", {"kind": "achievement", "ref": "first_game"})
    assert bad.json()["detail"]["code"] == "attachment_invalid"           # ещё не заработано
    db_session.add(UserAchievement(user_id=test_user_1.id, code="first_game"))
    await db_session.commit()
    card = post(client, token_user_1, "", {"kind": "achievement", "ref": "first_game"}).json()["attachment"]
    assert card["kind"] == "achievement" and card["ref"] == "first_game" and card["earned_at"]
    assert post(client, token_user_1, "", {"kind": "video", "ref": "1"}).status_code == 422


async def test_library_games_with_limited_visibility_stay_inside(client, token_user_1, test_user_1, db_session):
    public = LibraryCollection(path="pub", name="pub", visibility="public")
    private = LibraryCollection(path="own", name="own", visibility="owner", owner_id=test_user_1.id)
    open_game = LibraryGame(moves_hash="a" * 64, white="Anderssen", black="Kieseritzky", result="1-0", year=1851)
    closed_game = LibraryGame(moves_hash="b" * 64, white="X", black="Y", result="0-1")
    db_session.add_all([public, private, open_game, closed_game])
    await db_session.flush()
    db_session.add_all([LibraryGameCollection(game_id=open_game.id, collection_id=public.id),
                        LibraryGameCollection(game_id=closed_game.id, collection_id=private.id)])
    await db_session.commit()
    card = post(client, token_user_1, "", {"kind": "library", "ref": str(open_game.id)}).json()["attachment"]
    assert (card["white"], card["black"], card["result"], card["year"]) == ("Anderssen", "Kieseritzky", "1-0", 1851)
    hidden = post(client, token_user_1, "", {"kind": "library", "ref": str(closed_game.id)})
    assert hidden.status_code == 400 and hidden.json()["detail"]["code"] == "attachment_invalid"


async def test_likes_comments_and_notification(client, token_user_1, token_user_2, test_user_1, db_session, monkeypatch):
    delivered = []

    async def fake_deliver(user_id, note):
        delivered.append((user_id, note["kind"], note["payload"]))

    monkeypatch.setattr(notifications, "deliver", fake_deliver)
    post_id = post(client, token_user_1, "Этюд").json()["id"]
    liked = client.post(f"{API}/posts/{post_id}/like", headers=auth(token_user_2)).json()
    assert (liked["likes"], liked["liked"]) == (1, True)
    assert client.post(f"{API}/posts/{post_id}/like", headers=auth(token_user_2)).json()["likes"] == 1   # повтор
    assert client.delete(f"{API}/posts/{post_id}/like", headers=auth(token_user_2)).json()["likes"] == 0

    comment = client.post(f"{API}/posts/{post_id}/comments", json={"body": "Красиво!"}, headers=auth(token_user_2))
    assert comment.status_code == 201 and comment.json()["author"] == "player2"
    client.post(f"{API}/posts/{post_id}/comments", json={"body": "Спасибо"}, headers=auth(token_user_1))
    assert delivered == [(test_user_1.id, "post_comment", {"from": "player2", "post_id": post_id})]   # свой — без уведомления
    kinds = (await db_session.execute(select(Notification.kind).where(Notification.user_id == test_user_1.id))).scalars().all()
    assert kinds == ["post_comment"]

    view = client.get(f"{API}/posts/{post_id}", headers=auth(token_user_1)).json()
    assert view["post"]["comments"] == 2
    assert [(c["body"], c["can_delete"]) for c in view["comments"]] == [("Красиво!", True), ("Спасибо", True)]
    empty = client.post(f"{API}/posts/{post_id}/comments", json={"body": " "}, headers=auth(token_user_2))
    assert empty.json()["detail"]["code"] == "comment_empty"

    # Автор публикации удаляет чужой комментарий; посторонний — нет.
    theirs = view["comments"][0]["id"]
    assert client.delete(f"{API}/comments/{view['comments'][1]['id']}", headers=auth(token_user_2)).status_code == 404
    assert client.delete(f"{API}/comments/{theirs}", headers=auth(token_user_1)).status_code == 200


async def test_block_and_chat_ban(client, token_user_1, token_user_2, test_user_2, db_session):
    post_id = post(client, token_user_1, "Пост").json()["id"]
    client.post("/api/v1/messages/block/player2", headers=auth(token_user_1))
    closed = client.post(f"{API}/posts/{post_id}/comments", json={"body": "!"}, headers=auth(token_user_2))
    assert closed.status_code == 403 and closed.json()["detail"]["code"] == "comment_closed"
    # Кого я заблокировал — того нет в моей ленте, даже если подписан.
    client.post("/api/v1/social/follow/player2", headers=auth(token_user_1))
    post(client, token_user_2, "Спам")
    assert [p["body"] for p in client.get(API, headers=auth(token_user_1)).json()["posts"]] == ["Пост"]

    test_user_2.chat_banned_until = datetime.now(UTC) + timedelta(hours=1)
    await db_session.commit()
    banned = post(client, token_user_2, "ещё")
    assert banned.status_code == 403 and banned.json()["detail"]["code"] == "posting_banned"


async def test_hidden_and_deleted(client, token_user_1, token_user_2, db_session):
    post_id = post(client, token_user_1, "Скрытое").json()["id"]
    item = await db_session.get(Post, post_id)
    item.hidden_at = datetime.now(UTC)
    await db_session.commit()
    assert client.get(f"{API}/posts/{post_id}", headers=auth(token_user_2)).status_code == 404
    assert client.get(f"{API}/posts/{post_id}", headers=auth(token_user_1)).json()["post"]["hidden"] is True
    assert client.get(f"{API}/user/player1").json()["posts"] == []

    other = post(client, token_user_1, "Удалить").json()["id"]
    assert client.delete(f"{API}/posts/{other}", headers=auth(token_user_2)).status_code == 404   # чужое — нельзя
    assert client.delete(f"{API}/posts/{other}", headers=auth(token_user_1)).json() == {"deleted": True}
    assert client.get(f"{API}/posts/{other}", headers=auth(token_user_1)).status_code == 404
