# --- FILE: tests/test_guess_api.py ---
"""«Угадай ход мастера» (таск 14.3): выдача позиций, баллы за ответ, моменты партии, серии."""

import chess
import chess.pgn
import pytest

from src.models.game import Game, GameStatus
from src.models.guess import GuessPosition
from src.services.guess import score_answer

PGN = """[Event "Paris"]
[White "Legal"]
[Black "Saint Brie"]
[Date "1750.??.??"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0
"""


def _fen_at(ply: int) -> str:
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "d6", "Bc4", "Bg4", "Nc3", "g6", "Nxe5", "Bxd1", "Bxf7+", "Ke7", "Nd5#"][:ply]:
        board.push_san(san)
    return board.fen()


@pytest.fixture
async def seeded(db_session, test_user_1, test_user_2):
    game = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED,
                pgn=PGN, result="1-0")
    db_session.add(game)
    await db_session.flush()
    first = GuessPosition(game_id=game.id, ply=8, fen=_fen_at(8), move_uci="f3e5", best_cp=300, gap_cp=200,
                          lines=[["f3e5", 300], ["c3d5", 280], ["h2h3", 100]], series_id=7, series_index=0,
                          difficulty=1500)
    second = GuessPosition(game_id=game.id, ply=10, fen=_fen_at(10), move_uci="c4f7", best_cp=900, gap_cp=500,
                           lines=[["c4f7", 900], ["e5g4", 400]], series_id=7, series_index=1, difficulty=1550)
    db_session.add_all([first, second])
    await db_session.commit()
    return game, first, second


def test_score_rules():
    position = GuessPosition(move_uci="f3e5", best_cp=300, gap_cp=200, lines=[["f3e5", 300], ["c3d5", 280], ["h2h3", 100]])
    assert score_answer(position, "f3e5") == (100, 0)
    assert score_answer(position, "c3d5") == (80, 20)            # не хуже лучшего на 30 сп
    assert score_answer(position, "h2h3") == (46, 200)           # 80 − (200 − 30) / 5
    assert score_answer(position, "a2a3") == (36, 250)           # вне строк: отрыв + запас
    worst = GuessPosition(move_uci="f3e5", best_cp=300, gap_cp=600, lines=[["f3e5", 300]])
    assert score_answer(worst, "a2a3")[0] == 0


async def test_next_position_with_game_context(client, seeded):
    body = client.get("/api/v1/guess/next").json()["position"]
    assert body["white"] == "Legal" and body["date"] == "1750"
    assert body["series_length"] == 2
    if body["ply"] == 8:
        assert body["previous"][-1] == "g6" and body["side"] == "white" and body["move_number"] == 5
    series_start = client.get("/api/v1/guess/next", params={"series": "true"}).json()["position"]
    assert series_start["series_index"] == 0


async def test_answer_scores_and_explains(client, seeded):
    _, first, second = seeded
    res = client.post(f"/api/v1/guess/position/{first.id}/answer", json={"move": "f3e5"}).json()
    assert res["score"] == 100 and res["master_san"] == "Nxe5" and res["next_id"] == second.id
    assert res["comment"] and res["lines"][0]["san"] == "Nxe5"
    near = client.post(f"/api/v1/guess/position/{first.id}/answer", json={"move": "c3d5"}).json()
    assert near["score"] == 80
    last = client.post(f"/api/v1/guess/position/{second.id}/answer", json={"move": "c4f7"}).json()
    assert last["next_id"] is None


async def test_answer_counts_plays(client, seeded, db_session):
    _, first, _ = seeded
    client.post(f"/api/v1/guess/position/{first.id}/answer", json={"move": "f3e5"})
    client.post(f"/api/v1/guess/position/{first.id}/answer", json={"move": "h2h3"})
    await db_session.refresh(first)
    assert (first.plays, first.solved) == (2, 1)


async def test_errors(client, seeded):
    _, first, _ = seeded
    illegal = client.post(f"/api/v1/guess/position/{first.id}/answer", json={"move": "e1e3"})
    assert illegal.status_code == 400 and illegal.json()["detail"]["code"] == "illegal_move"
    missing = client.get("/api/v1/guess/position/999999")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "guess_position_not_found"


async def test_positions_of_a_game(client, seeded):
    game, first, second = seeded
    body = client.get(f"/api/v1/guess/game/{game.id}").json()
    assert [p["ply"] for p in body["positions"]] == [8, 10]
    assert client.get("/api/v1/guess/game/424242").json() == {"positions": []}


def test_empty_pool(client):
    assert client.get("/api/v1/guess/next").json() == {"position": None}
