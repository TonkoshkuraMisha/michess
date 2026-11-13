# --- FILE: tests/test_tournament_play.py ---
"""Партия игрока в турнире (таск 15.3): сохранение партии с ботом записывает результат в турнир."""

import pytest

API = "/api/v1/tournaments"
SAVE = "/api/v1/bots/save-game"
# Мат чёрным: белые ходят первыми — партия, где игрок белыми проигрывает, а чёрными выигрывает.
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create(client, token, participants=None, fmt="round_robin"):
    participants = participants or [{"kind": "bot", "id": b} for b in ("morphy", "philidor", "staunton")]
    body = {"format": fmt, "size": 4, "participants": participants, "base_time_ms": 300_000, "increment_ms": 2_000}
    return client.post(API, headers=auth(token), json=body).json()


def my_game(t):
    me = t["my_seat"]
    game = next(g for g in t["games"] if g["round"] == t["current_round"] and g["result"] is None
                and me in (g["white_seat"], g["black_seat"]))
    color = "white" if game["white_seat"] == me else "black"
    opponent_seat = game["black_seat"] if color == "white" else game["white_seat"]
    opponent = next(p for p in t["players"] if p["seat"] == opponent_seat)
    return game, color, opponent


def save_body(game, color, opponent, **extra):
    body = {
        "player_color": color, "result": "0-1", "moves_uci": FOOLS_MATE,
        "base_time_ms": game["base_time_ms"], "increment_ms": game["increment_ms"], "tournament_game_id": game["id"],
    }
    if opponent["kind"] == "bot":
        body["bot_id"] = opponent["bot_key"]
    else:
        body.update(bot_id="custom", personality_name=opponent["bot_key"] or opponent["personality_name"])
    return {**body, **extra}


def test_players_game_result_goes_into_the_tournament(client, token_user_1, published_simulations):
    t = create(client, token_user_1)
    game, color, opponent = my_game(t)
    saved = client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent))
    assert saved.status_code == 200, saved.text
    assert saved.json()["tournament_id"] == t["id"]

    state = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    recorded = next(g for g in state["games"] if g["id"] == game["id"])
    assert recorded["result"] == "0-1" and recorded["game_id"] == saved.json()["game_id"]


def test_archetype_and_personality_opponents_are_playable(client, token_user_1):
    pid = client.post("/api/v1/bots/personalities", headers=auth(token_user_1),
                      json={"name": "Gambiteer", "config": {"aggression": 80, "target_elo": 2500}}).json()["id"]
    t = create(client, token_user_1, [
        {"kind": "personality", "id": pid}, {"kind": "archetype", "id": "combinator"}, {"kind": "bot", "id": "morphy"},
    ])
    custom = [p for p in t["players"] if p["kind"] in ("personality", "archetype")]
    assert all(p["config"]["target_elo"] for p in custom)  # клиенту есть чем играть через /custom-move
    game, color, opponent = my_game(t)
    saved = client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent))
    assert saved.status_code == 200, saved.text


@pytest.mark.parametrize("change", [
    {"bot_id": "paulsen"},  # другой соперник
    {"base_time_ms": 60_000},  # другой контроль
    {"start_fen": "8/8/8/8/8/8/8/K6k w - - 0 1"},  # своя позиция
])
def test_game_must_match_the_tournament_game(client, token_user_1, change):
    t = create(client, token_user_1)
    game, color, opponent = my_game(t)
    response = client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent, **change))
    assert response.status_code in (400, 409)
    if response.status_code == 409:
        assert response.json()["detail"]["code"] == "tournament_game_mismatch"


def test_wrong_color_is_rejected(client, token_user_1):
    t = create(client, token_user_1)
    game, color, opponent = my_game(t)
    other = "black" if color == "white" else "white"
    response = client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent, player_color=other))
    assert response.status_code == 409


def test_cannot_play_someone_elses_or_a_closed_game(client, token_user_1, token_user_2):
    t = create(client, token_user_1)
    game, color, opponent = my_game(t)
    stranger = client.post(SAVE, headers=auth(token_user_2), json=save_body(game, color, opponent))
    assert stranger.status_code == 404 and stranger.json()["detail"]["code"] == "tournament_not_found"

    assert client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent)).status_code == 200
    again = client.post(SAVE, headers=auth(token_user_1), json=save_body(game, color, opponent))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "tournament_game_closed"


def test_bot_vs_bot_game_cannot_be_reported_by_the_player(client, token_user_1):
    t = create(client, token_user_1)
    me = t["my_seat"]
    bots_game = next(g for g in t["games"] if g["round"] == 1 and me not in (g["white_seat"], g["black_seat"]))
    response = client.post(SAVE, headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": FOOLS_MATE,
        "base_time_ms": 300_000, "increment_ms": 2_000, "tournament_game_id": bots_game["id"],
    })
    assert response.status_code == 409 and response.json()["detail"]["code"] == "tournament_game_mismatch"
