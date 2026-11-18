# --- FILE: tests/test_mini_game_rooms.py ---
"""
Игры тренеров с человеком по сети (таск 19.8): комната на двоих через настоящие запросы клиента — создание с цветом,
вход по ссылке, очередь хода и версия, ход не по правилам, конец по правилам игры, сдача, «ещё раз» со сменой цветов,
посторонний и третий игрок.
"""

from src.models.user import User
from src.services import mini_game_rooms as rooms

API = "/api/v1/mini-game-rooms"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_friendly_mini_game_through_the_client(client, db_session, test_user_1, test_user_2,
                                                     token_user_1, token_user_2):
    created = client.post(API, headers=auth(token_user_1), json={"game_id": "pawn_war", "color": "white"})
    assert created.status_code == 200, created.text
    room = created.json()
    code = room["code"]
    assert (room["you"], room["waiting"], room["white"], room["black"]) == ("white", True, test_user_1.username, None)

    # Соперника нет — ходить рано; гость видит комнату, но он не игрок.
    early = client.post(f"{API}/{code}/move", headers=auth(token_user_1), json={"move": "e2e4", "version": 0})
    assert early.status_code == 409 and early.json()["detail"]["code"] == "mini_room_waiting"
    assert client.get(f"{API}/{code}").json()["you"] is None

    joined = client.post(f"{API}/{code}/join", headers=auth(token_user_2)).json()
    assert (joined["you"], joined["waiting"], joined["black"]) == ("black", False, test_user_2.username)

    not_turn = client.post(f"{API}/{code}/move", headers=auth(token_user_2), json={"move": "e7e5", "version": 0})
    assert not_turn.json()["detail"]["code"] == "mini_room_not_your_turn"
    illegal = client.post(f"{API}/{code}/move", headers=auth(token_user_1), json={"move": "e2e5", "version": 0})
    assert illegal.status_code == 400 and illegal.json()["detail"]["code"] == "mini_game_illegal_move"
    moved = client.post(f"{API}/{code}/move", headers=auth(token_user_1), json={"move": "e2e4", "version": 0}).json()
    assert (moved["moves"], moved["version"]) == (["e2e4"], 1)
    stale = client.post(f"{API}/{code}/move", headers=auth(token_user_1), json={"move": "d2d4", "version": 0})
    assert stale.json()["detail"]["code"] == "mini_room_stale"
    # Соперник видит ход, опрашивая комнату.
    assert client.get(f"{API}/{code}", headers=auth(token_user_2)).json()["moves"] == ["e2e4"]

    # Третий игрок не войдёт, посторонний не сдастся.
    third = User(username="third_player", hashed_password="x")
    db_session.add(third)
    await db_session.commit()
    assert (await _refused(rooms.join(third, code))) == "mini_room_full"
    assert (await _refused(rooms.resign(third, code))) == "mini_room_not_player"

    # Сдача — победа соперника; «ещё раз» — новая комната со сменой цветов, старая ведёт в неё.
    resigned = client.post(f"{API}/{code}/resign", headers=auth(token_user_2)).json()
    assert (resigned["result"], resigned["reason"]) == ("1-0", "resign")
    again = client.post(f"{API}/{code}/rematch", headers=auth(token_user_2)).json()
    assert (again["you"], again["white"], again["black"], again["moves"]) == ("white", test_user_2.username,
                                                                           test_user_1.username, [])
    assert client.get(f"{API}/{code}").json()["next"] == again["code"]
    assert client.post(f"{API}/{code}/rematch", headers=auth(token_user_1)).json()["code"] == again["code"]


async def test_game_ends_by_its_rules(client, test_user_1, test_user_2, token_user_1, token_user_2):
    code = client.post(API, headers=auth(token_user_1), json={"game_id": "pawn_war", "color": "white"}).json()["code"]
    client.post(f"{API}/{code}/join", headers=auth(token_user_2))
    # Позиция перед проходом белой пешки: проведённая пешка — победа по правилам пешечного боя.
    room = await rooms._load(code)
    room["fen"] = "8/P6p/8/8/8/8/7P/8 w - - 0 1"
    await rooms._save(room)
    done = client.post(f"{API}/{code}/move", headers=auth(token_user_1), json={"move": "a7a8", "version": 0}).json()
    assert (done["result"], done["reason"]) == ("1-0", "rules")
    over = client.post(f"{API}/{code}/move", headers=auth(token_user_2), json={"move": "h7h6", "version": 1})
    assert over.json()["detail"]["code"] == "mini_game_over"


async def test_unknown_room_game_and_login(client, token_user_1):
    assert client.get(f"{API}/nosuchroom").status_code == 404
    assert client.post(API, headers=auth(token_user_1), json={"game_id": "nope"}).status_code == 404
    assert client.post(API, json={"game_id": "pawn_war"}).status_code == 401


async def _refused(call) -> str:
    try:
        await call
    except rooms.DomainError as exc:
        return exc.code
    raise AssertionError("expected a refusal")
