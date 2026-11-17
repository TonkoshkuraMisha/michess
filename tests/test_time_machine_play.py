# --- FILE: tests/test_time_machine_play.py ---
"""
Партия игрока с мастером прошлого в «Машине времени»: сохранение через тот же /bots/save-game, что и у
клиента. Имя мастера в PGN — «Фамилия, Имя»: правила имён игроков к нему не применяются.

До 17.11 таких тестов не было: результаты в тестах ставились сервисом напрямую, а настоящий запрос сервер
отклонял (400 username_invalid_chars) — партия игрока с мастером не записывалась, и турнир не продвигался.
"""

import pytest

from src.api.bots import BotGameSaveRequest, _resolve_personality_for_save
from src.services.bots.guests import GUESTS, GUESTS_BY_ID

API = "/api/v1/tournaments"
SAVE = "/api/v1/bots/save-game"
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def my_game(t):
    """Первая несыгранная партия игрока текущего круга, его цвет и соперник."""
    me = t["my_seat"]
    game = next(g for g in t["games"] if g["round"] == t["current_round"] and g["result"] is None
                and me in (g["white_seat"], g["black_seat"]))
    color = "white" if game["white_seat"] == me else "black"
    opponent_seat = game["black_seat"] if color == "white" else game["white_seat"]
    return game, color, next(p for p in t["players"] if p["seat"] == opponent_seat)


def master_event(client, token) -> tuple[dict, dict, str, dict]:
    """Исторический турнир, где первый соперник игрока — мастер прошлого (а не исторический бот)."""
    for key in ("avro_1938", "nottingham_1936", "kyiv_1903", "hastings_1895"):
        t = client.post(f"{API}/time-machine/{key}", json={}, headers=auth(token)).json()
        game, color, opponent = my_game(t)
        if opponent["kind"] == "personality":
            return t, game, color, opponent
        assert client.post(f"{API}/{t['id']}/withdraw", headers=auth(token)).status_code == 200
    raise AssertionError("no event starts with a master of the past")


def test_players_game_against_a_master_of_the_past_is_saved(client, token_user_1, published_simulations):
    t, game, color, opponent = master_event(client, token_user_1)
    guest = GUESTS_BY_ID[opponent["bot_key"].removeprefix("guest:")]
    assert opponent["personality_name"] == guest.pgn_name and ", " in guest.pgn_name

    started = client.post(f"{API}/{t['id']}/games/{game['id']}/start", headers=auth(token_user_1))
    assert started.status_code == 200, started.text
    # Клиент сохраняет партию под латинским именем мастера (CustomOpponent.savedName).
    saved = client.post(SAVE, headers=auth(token_user_1), json={
        "bot_id": "custom", "personality_name": guest.pgn_name, "player_color": color, "result": "0-1",
        "moves_uci": FOOLS_MATE, "base_time_ms": game["base_time_ms"], "increment_ms": game["increment_ms"],
        "tournament_game_id": game["id"],
    })
    assert saved.status_code == 200, saved.text
    state = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    recorded = next(g for g in state["games"] if g["id"] == game["id"])
    assert recorded["result"] == "0-1" and recorded["game_id"] == saved.json()["game_id"]

    # В архиве игрока соперник — под именем мастера, с его рейтингом в PGN.
    pgn = client.get(f"/api/v1/profile/games/{saved.json()['game_id']}/pgn", headers=auth(token_user_1))
    assert pgn.status_code == 200 and guest.pgn_name in pgn.text and str(guest.rating) in pgn.text, pgn.text[:300]


async def test_every_master_is_accepted_as_the_saved_opponent():
    """Имя любого мастера (с запятой, пробелами и точками) сервер принимает и отдаёт его рейтинг из реестра."""
    for guest in GUESTS:
        payload = BotGameSaveRequest(bot_id="custom", personality_name=guest.pgn_name, player_color="white",
                                     result="1-0", moves_uci=["e2e4"])
        # Запрос к базе для мастера не нужен: имя и сила — из реестра.
        assert await _resolve_personality_for_save(None, None, payload) == (guest.pgn_name, guest.rating), guest.id  # type: ignore[arg-type]


async def test_a_name_with_a_comma_that_is_not_a_master_is_still_rejected():
    from src.core.errors import ApiError

    payload = BotGameSaveRequest(bot_id="custom", personality_name="Nobody, At All", player_color="white",
                                 result="1-0", moves_uci=["e2e4"])
    with pytest.raises(ApiError) as caught:
        await _resolve_personality_for_save(None, None, payload)  # type: ignore[arg-type]
    assert caught.value.status_code == 400
