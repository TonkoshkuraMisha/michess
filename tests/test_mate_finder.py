# --- FILE: tests/test_mate_finder.py ---
"""«Найти мат» (таск 16.4): линия мата из ответа движка, глубина, ошибки, правило честной игры. Движок подменён."""

import chess
import pytest

from src.services import mate_finder
from src.services.engine_pool import EngineUnavailableError
from src.services.game_state import state_manager

API = "/api/v1/analysis/find-mate"
BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"


@pytest.fixture
def engine(monkeypatch):
    answers: dict[str, tuple[int | None, list[str]]] = {}

    def fake(board: chess.Board, moves: int):
        mate, line = answers.get(board.fen(), (None, []))
        return mate, [chess.Move.from_uci(u) for u in line]

    monkeypatch.setattr(mate_finder, "_search", fake)
    return answers


def test_mate_line_is_cut_to_the_mating_move(client, engine):
    engine[BACK_RANK] = (1, ["a1a8", "g8h7"])          # движок может дописать ход после мата — его не показываем
    body = client.post(API, json={"fen": BACK_RANK, "moves": 2}).json()
    assert body == {"found": True, "mate_in": 1, "line": ["a1a8"], "san": ["Ra8#"]}


def test_longer_mate_than_asked_or_losing_side(client, engine):
    engine[BACK_RANK] = (3, ["a1a8"])
    assert client.post(API, json={"fen": BACK_RANK, "moves": 2}).json()["found"] is False
    engine[BACK_RANK] = (-2, ["a1a2"])                  # мат получает сторона, которая ходит
    assert client.post(API, json={"fen": BACK_RANK, "moves": 5}).json()["found"] is False


def test_validation(client, engine):
    assert client.post(API, json={"fen": BACK_RANK, "moves": 6}).status_code == 422
    bad = client.post(API, json={"fen": "8/8/8/8/8/8/8/8 w - - 0 1", "moves": 1})
    assert bad.status_code == 400
    mated = client.post(API, json={"fen": "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1", "moves": 1}).json()
    assert mated["found"] is False                       # мат уже стоит — искать нечего


def test_engine_unavailable_is_503(client, monkeypatch):
    def broken(board, moves):
        raise EngineUnavailableError("no engine")

    monkeypatch.setattr(mate_finder, "_search", broken)
    response = client.post(API, json={"fen": BACK_RANK, "moves": 1})
    assert response.status_code == 503 and response.json()["detail"]["code"] == "engine_busy"


async def test_closed_during_a_game_with_a_person(client, engine, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=613, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(API, json={"fen": BACK_RANK, "moves": 1}, headers={"Authorization": f"Bearer {token_user_1}"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_locked_in_game"
