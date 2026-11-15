# --- FILE: tests/test_tablebase.py ---
"""Эндшпильные таблицы (таск 14.4): ответ таблиц, лучший ход защитника, кэш, ошибки, правило честной игры."""

import httpx
import pytest

from src.services import tablebase
from src.services.game_state import state_manager

API = "/api/v1/analysis/tablebase"
KQK = "8/8/8/4k3/8/8/8/KQ6 w - - 0 1"
LICHESS_ANSWER = {
    "category": "win", "dtm": 17, "dtz": 17,
    "moves": [{"uci": "b1f1", "category": "loss", "dtm": -16, "dtz": -16}, {"uci": "b1b5", "category": "loss", "dtm": -18}],
}


@pytest.fixture
def lichess(monkeypatch):
    calls: list[str] = []

    async def fake(fen: str) -> dict:
        calls.append(fen)
        return LICHESS_ANSWER

    monkeypatch.setattr(tablebase, "_fetch", fake)
    return calls


def test_probe_returns_result_and_best_move(client, lichess):
    body = client.post(API, json={"fen": KQK}).json()
    assert body == {"category": "win", "dtm": 17, "dtz": 17,
                    "best": {"uci": "b1f1", "san": "Qf1", "category": "loss", "dtm": -16, "dtz": -16}}


def test_answers_are_cached(client, lichess):
    client.post(API, json={"fen": KQK})
    client.post(API, json={"fen": KQK})
    assert lichess == [KQK]


def test_too_many_pieces_and_bad_fen(client, lichess):
    start = client.post(API, json={"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"})
    assert start.status_code == 400 and start.json()["detail"]["code"] == "tablebase_too_many_pieces"
    assert client.post(API, json={"fen": "8/8/8/8/8/8/8/8 w - - 0 1"}).status_code == 400
    assert lichess == []


def test_unavailable_tables_are_503(client, monkeypatch):
    async def down(fen: str) -> dict:
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(tablebase, "_fetch", down)
    response = client.post(API, json={"fen": KQK})
    assert response.status_code == 503 and response.json()["detail"]["code"] == "tablebase_unavailable"


async def test_closed_during_a_game_with_a_person(client, lichess, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=614, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(API, json={"fen": KQK}, headers={"Authorization": f"Bearer {token_user_1}"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_locked_in_game"
