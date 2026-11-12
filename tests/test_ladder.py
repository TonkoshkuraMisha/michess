# --- FILE: tests/test_ladder.py ---
"""
Клубная лестница (таск 10.4): соперники по измеренной силе, отдельный рейтинг, ступени, и
серверная проверка честности — подсказка движка, возврат хода и подмена соперника не засчитываются.
"""

import chess
import pytest

from src.services import ladder
from src.services.bots import base as bots_base
from src.services.bots import calibration
from src.services.bots.archetypes import ARCHETYPES

API = "/api/v1/bots"
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]  # мат белым на 4-м полуходе
# Белые ставят мат за 4 хода (детский мат): игрок белыми выигрывает.
SCHOLARS_MATE = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def no_engine(monkeypatch):
    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})


@pytest.fixture
def fake_calibration(monkeypatch):
    """Измеренная сила: «Торопыга» (rusher) самый слабый, Морфи — сильнее заявленного."""
    data = {
        "meta": {"date": "2026-11-12", "games": 10},
        "players": {
            "archetype:rusher": {"rating": 650, "games": 40, "ci95": 90},
            "morphy": {"rating": 2050, "games": 40, "ci95": 80},
        },
    }
    calibration.load_calibration.cache_clear()
    monkeypatch.setattr(calibration, "load_calibration", lambda: data)
    return data


def fens_along(moves: list[str]) -> list[chess.Board]:
    board = chess.Board()
    boards = []
    for uci in moves:
        boards.append(board.copy())
        board.push_uci(uci)
    return boards


def play_ladder_moves(client, token, opponent: dict, moves: list[str], player_color: str):
    """Запросы ходов соперника — как их делает клиент — для позиций, где ходит соперник."""
    for board in fens_along(moves):
        bot_to_move = (board.turn == chess.WHITE) != (player_color == "white")
        if not bot_to_move:
            continue
        if opponent["kind"] == "historical":
            body = {"bot_id": opponent["bot_id"], "fen": board.fen()}
            url = f"{API}/move"
        else:
            body = {"config": opponent["config"], "fen": board.fen()}
            url = f"{API}/custom-move"
        assert client.post(url, headers=auth(token), json=body).status_code == 200


def save(client, token, opponent: dict, moves: list[str], color: str, result: str, **extra):
    body = {"player_color": color, "result": result, "moves_uci": moves, "ladder": True, **extra}
    if opponent["kind"] == "historical":
        body["bot_id"] = opponent["bot_id"]
    else:
        body.update(bot_id="custom", personality_name=opponent["key"])
    return client.post(f"{API}/save-game", headers=auth(token), json=body)


# --- Лестница и каталог --------------------------------------------------------------------------

def test_rungs_are_ordered_by_measured_strength(fake_calibration):
    items = ladder.rungs()
    assert len(items) == 7 + len(ARCHETYPES)
    assert [r.rating for r in items] == sorted(r.rating for r in items)
    assert items[0].key == "archetype:rusher" and items[0].measured and items[0].rating == 650
    morphy = next(r for r in items if r.key == "morphy")
    assert morphy.rating == 2050 and morphy.measured
    assert not next(r for r in items if r.key == "philidor").measured


def test_catalog_lists_archetypes_with_configs(client, fake_calibration):
    body = client.get(f"{API}/catalog").json()
    assert len(body["archetypes"]) == len(ARCHETYPES)
    first = next(a for a in body["archetypes"] if a["id"] == "rusher")
    assert first["measured"] and first["rating"] == 650 and first["declared_rating"] == 700
    assert first["config"]["target_elo"] == 700
    assert {h["id"] for h in body["historical"]} >= {"morphy", "philidor"}
    assert body["calibration"]["games"] == 10


def test_new_player_starts_at_the_bottom(client, token_user_1, fake_calibration):
    state = client.get(f"{API}/ladder", headers=auth(token_user_1)).json()
    assert state["rating"] == 1000 and state["step"] == 0 and state["games"] == 0
    assert state["rungs"][0]["status"] == "current"
    assert all(r["status"] == "locked" for r in state["rungs"][1:])
    assert client.get(f"{API}/ladder").status_code == 401


# --- Честная победа ------------------------------------------------------------------------------

def test_clean_win_raises_rating_and_unlocks_next_rung(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    opponent = start["opponent"]
    assert opponent["id"] == "rusher" and opponent["kind"] == "archetype" and start["color"] == "white"

    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE, "white")
    saved = save(client, token_user_1, opponent, SCHOLARS_MATE, "white", "1-0")
    assert saved.status_code == 200, saved.text
    outcome = saved.json()["ladder"]
    assert outcome["counted"] and outcome["delta"] > 0 and outcome["promoted"] and outcome["step"] == 1

    state = client.get(f"{API}/ladder", headers=auth(token_user_1)).json()
    assert state["rating"] == 1000 + outcome["delta"] and state["games"] == 1
    assert state["rungs"][0]["status"] == "beaten" and state["rungs"][1]["status"] == "current"
    assert state["active_opponent"] is None

    profile = client.get("/api/v1/profile/player1").json()
    assert profile["ladder"] == {"rating": state["rating"], "games": 1, "step": 1, "total": len(state["rungs"])}


def test_loss_lowers_rating_and_keeps_the_rung(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    play_ladder_moves(client, token_user_1, start["opponent"], FOOLS_MATE, "white")
    outcome = save(client, token_user_1, start["opponent"], FOOLS_MATE, "white", "0-1").json()["ladder"]
    assert outcome["counted"] and outcome["delta"] < 0 and not outcome["promoted"] and outcome["step"] == 0


# --- Нечестная партия не засчитывается -----------------------------------------------------------

def test_engine_hint_for_players_side_voids_the_game(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    # Игрок спрашивает ход у движка в своей позиции (белые ходят).
    client.post(f"{API}/move", headers=auth(token_user_1), json={"bot_id": "morphy", "fen": chess.STARTING_FEN})
    play_ladder_moves(client, token_user_1, start["opponent"], SCHOLARS_MATE, "white")

    outcome = save(client, token_user_1, start["opponent"], SCHOLARS_MATE, "white", "1-0").json()["ladder"]
    assert not outcome["counted"] and outcome["reason"] == "engine_hint"
    assert client.get(f"{API}/ladder", headers=auth(token_user_1)).json()["rating"] == 1000


def test_position_analysis_voids_the_game(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    client.post("/api/v1/analysis/position", headers=auth(token_user_1), json={"moves": ["e2e4"]})
    play_ladder_moves(client, token_user_1, start["opponent"], SCHOLARS_MATE, "white")
    outcome = save(client, token_user_1, start["opponent"], SCHOLARS_MATE, "white", "1-0").json()["ladder"]
    assert not outcome["counted"] and outcome["reason"] == "engine_analysis"


def test_takeback_voids_the_game(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    opponent = start["opponent"]
    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE[:4], "white")
    # Возврат хода: соперника снова спрашивают о позиции, которую он уже прошёл.
    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE, "white")
    outcome = save(client, token_user_1, opponent, SCHOLARS_MATE, "white", "1-0").json()["ladder"]
    assert not outcome["counted"] and outcome["reason"] == "takeback"


def test_retried_request_for_the_same_position_is_not_a_takeback(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    opponent = start["opponent"]
    # Ход соперника после 1.e4 запрошен дважды (ретрай после сбоя связи), затем партия идёт дальше.
    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE[:2], "white")
    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE[:2], "white")
    play_ladder_moves(client, token_user_1, opponent, SCHOLARS_MATE, "white")
    outcome = save(client, token_user_1, opponent, SCHOLARS_MATE, "white", "1-0").json()["ladder"]
    assert outcome["counted"], outcome


def test_weakened_opponent_voids_the_game(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    weakened = {**start["opponent"], "config": {**start["opponent"]["config"], "target_elo": 600}}
    play_ladder_moves(client, token_user_1, weakened, SCHOLARS_MATE, "white")
    outcome = save(client, token_user_1, start["opponent"], SCHOLARS_MATE, "white", "1-0").json()["ladder"]
    assert not outcome["counted"] and outcome["reason"] == "opponent_swapped"


def test_save_must_match_the_open_ladder_game(client, token_user_1, fake_calibration):
    no_session = save(client, token_user_1, {"kind": "historical", "bot_id": "morphy"}, FOOLS_MATE, "white", "0-1")
    assert no_session.status_code == 409

    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    wrong_color = save(client, token_user_1, start["opponent"], FOOLS_MATE, "black", "0-1")
    assert wrong_color.status_code == 409
    wrong_bot = save(client, token_user_1, {"kind": "historical", "bot_id": "morphy"}, FOOLS_MATE, "white", "0-1")
    assert wrong_bot.status_code == 409


def test_abandoned_started_game_counts_as_loss(client, token_user_1, fake_calibration):
    start = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "black"}).json()
    # Соперник (белые) сделал первый ход — партия начата, но игрок её бросил.
    play_ladder_moves(client, token_user_1, start["opponent"], ["e2e4"], "black")

    restart = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    assert restart["forfeited"]["counted"] and restart["forfeited"]["delta"] < 0
    assert client.get(f"{API}/ladder", headers=auth(token_user_1)).json()["games"] == 1


def test_unstarted_session_can_be_reopened_for_free(client, token_user_1, fake_calibration):
    client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "black"})
    restart = client.post(f"{API}/ladder/start", headers=auth(token_user_1), json={"color": "white"}).json()
    assert restart["forfeited"] is None


def test_regular_bot_games_do_not_touch_the_ladder(client, token_user_1, fake_calibration):
    saved = client.post(f"{API}/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE,
    })
    assert saved.status_code == 200 and saved.json()["ladder"] is None
    assert client.get(f"{API}/ladder", headers=auth(token_user_1)).json()["games"] == 0


def test_expected_score_and_k_factor():
    assert ladder.expected_score(1500, 1500) == pytest.approx(0.5)
    assert ladder.expected_score(1900, 1500) == pytest.approx(0.909, abs=0.01)
