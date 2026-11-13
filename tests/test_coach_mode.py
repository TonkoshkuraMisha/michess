# --- FILE: tests/test_coach_mode.py ---
"""
Игра с наставником (таск 11.3): проверка хода игрока, общий кэш оценок, правила честной игры и учебная отметка.

Движок подменяется заданными оценками по позициям: так результат не зависит от Stockfish и одинаков в CI.
"""

import chess
import pytest

from src.core.config import settings
from src.services import ladder as ladder_service
from src.services import move_check
from src.services.game_state import state_manager
from src.services.move_check import PositionEval

URL = "/api/v1/analysis/check-move"
ADVICE_URL = "/api/v1/analysis/advice"
ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
FORK_SETUP = "r2qk2r/ppp2ppp/2n5/4N3/2B5/8/PPP2PPP/R2QK2R w KQkq - 0 10"
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def _after(fen: str, uci: str) -> str:
    board = chess.Board(fen)
    board.push_uci(uci)
    return board.fen()


def _key(fen: str) -> str:
    return " ".join(fen.split()[:4])


@pytest.fixture
def engine(monkeypatch):
    """Подменённый движок: оценки по позициям, подсчёт обращений."""
    table: dict[str, PositionEval] = {}
    calls: list[str] = []

    def fake(board: chess.Board) -> PositionEval | None:
        calls.append(_key(board.fen()))
        return table.get(_key(board.fen()), PositionEval(0, None, None))

    monkeypatch.setattr(move_check, "engine_evaluate", fake)

    def setup(fen: str, cp_white: int, best: str | None) -> None:
        table[_key(fen)] = PositionEval(cp_white, None, best)

    setup.calls = calls  # type: ignore[attr-defined]
    return setup


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_blunder_is_measured_and_explained(client, engine):
    engine(ITALIAN, 30, "e1g1")
    engine(_after(ITALIAN, "c4f7"), -250, "e8f7")
    body = client.post(URL, json={"fen": ITALIAN, "move": "c4f7"}).json()
    assert body["available"] is True
    assert body["cp_loss"] == 280 and body["classification"] == "Blunder" and body["symbol"] == "??"
    assert body["eval_before"] == 30 and body["eval_after"] == -250
    assert body["best_move_uci"] == "e1g1" and body["reply_uci"] == "e8f7"
    keys = [s["key"].rsplit(".", 1)[0] for s in body["coach"]["comment"]]
    assert keys[:2] == ["coach.verdict.blunder", "coach.threat.hanging"]
    assert body["missed_tactic"] is False


def test_missed_tactic_is_flagged_even_with_a_small_loss(client, engine):
    engine(FORK_SETUP, 320, "e5f7")
    engine(_after(FORK_SETUP, "e1g1"), 250, None)
    body = client.post(URL, json={"fen": FORK_SETUP, "move": "e1g1"}).json()
    assert body["cp_loss"] == 70 and body["classification"] == "Inaccuracy"
    assert body["missed_tactic"] is True


def test_best_move_has_no_loss(client, engine):
    engine(FORK_SETUP, 320, "e5f7")
    engine(_after(FORK_SETUP, "e5f7"), 330, None)
    body = client.post(URL, json={"fen": FORK_SETUP, "move": "e5f7"}).json()
    assert body["cp_loss"] == 0 and body["classification"] == "Best"
    assert body["coach"]["comment"][0]["key"].startswith("coach.good.fork.")


def test_evaluations_are_from_the_movers_point_of_view(client, engine):
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    engine(fen, 30, "e7e5")
    engine(_after(fen, "f7f6"), 120, "d2d4")
    body = client.post(URL, json={"fen": fen, "move": "f7f6"}).json()
    assert body["eval_before"] == -30 and body["eval_after"] == -120 and body["cp_loss"] == 90


def test_without_engine_the_check_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(move_check, "resolve_stockfish_path", lambda *a, **k: None)
    assert client.post(URL, json={"fen": ITALIAN, "move": "e1g1"}).json() == {"available": False, "missed_tactic": False}


def test_positions_are_evaluated_once_across_check_takeback_and_advice(client, engine):
    engine(ITALIAN, 30, "e1g1")
    engine(_after(ITALIAN, "c4f7"), -250, "e8f7")
    client.post(URL, json={"fen": ITALIAN, "move": "c4f7"})
    client.post(URL, json={"fen": ITALIAN, "move": "c4f7"})  # переходил и сыграл то же
    client.post(ADVICE_URL, json={"fen": ITALIAN})
    assert sorted(engine.calls) == sorted([_key(ITALIAN), _key(_after(ITALIAN, "c4f7"))])


@pytest.mark.parametrize("payload, code", [
    ({"fen": ITALIAN, "move": "e1e3"}, "illegal_move"),
    ({"fen": ITALIAN, "move": "zz99"}, "illegal_move"),
    ({"fen": "nonsense", "move": "e2e4"}, "invalid_fen"),
])
def test_bad_requests_get_codes(client, engine, payload, code):
    response = client.post(URL, json=payload)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == code


async def test_closed_during_a_game_with_a_person(client, engine, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=711, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(URL, json={"fen": ITALIAN, "move": "e1g1"}, headers=_auth(token_user_1))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "engine_locked_in_game"


async def test_check_in_a_ladder_game_voids_it(client, engine, test_user_1, token_user_1):
    rung = ladder_service.rungs()[0]
    await ladder_service.open_session(test_user_1.id, rung, "white")
    assert client.post(URL, json={"fen": ITALIAN, "move": "e1g1"}, headers=_auth(token_user_1)).status_code == 200
    session = await ladder_service.get_session(test_user_1.id)
    assert session is not None and session.assisted == "engine_analysis"


def test_own_rate_limit(client, engine, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_MOVE_CHECK_GUEST", 2)
    for _ in range(2):
        assert client.post(URL, json={"fen": ITALIAN, "move": "e1g1"}).status_code == 200
    limited = client.post(URL, json={"fen": ITALIAN, "move": "e1g1"})
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "engine_rate_limited"


def test_game_with_coach_is_saved_as_assisted(client, token_user_1, test_user_1):
    saved = client.post("/api/v1/bots/save-game", headers=_auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE, "assisted": True,
    })
    assert saved.status_code == 200, saved.text
    plain = client.post("/api/v1/bots/save-game", headers=_auth(token_user_1), json={
        "bot_id": "philidor", "player_color": "white", "result": "0-1", "moves_uci": FOOLS_MATE,
    })
    assert plain.status_code == 200
    games = client.get(f"/api/v1/profile/{test_user_1.username}/games").json()["items"]
    flags = {g["game_id"]: g["assisted"] for g in games}
    assert flags[saved.json()["game_id"]] is True
    assert flags[plain.json()["game_id"]] is False
