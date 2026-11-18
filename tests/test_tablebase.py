# --- FILE: tests/test_tablebase.py ---
"""
Эндшпильные таблицы (таск 14.4): ответ таблиц, лучший ход защитника, кэш, ошибки, правило честной игры; запасной
ответ движка, когда сервер таблиц недоступен (пул движка подменён — бинарник в CI не используется).
"""

from contextlib import contextmanager

import chess
import chess.engine
import httpx
import pytest

from src.services import tablebase
from src.services.engine_pool import EngineBusyError
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
                    "best": {"uci": "b1f1", "san": "Qf1", "category": "loss", "dtm": -16, "dtz": -16},
                    "source": "tablebase"}


def test_answers_are_cached(client, lichess):
    client.post(API, json={"fen": KQK})
    client.post(API, json={"fen": KQK})
    assert lichess == [KQK]


def test_too_many_pieces_and_bad_fen(client, lichess):
    start = client.post(API, json={"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"})
    assert start.status_code == 400 and start.json()["detail"]["code"] == "tablebase_too_many_pieces"
    assert client.post(API, json={"fen": "8/8/8/8/8/8/8/8 w - - 0 1"}).status_code == 400
    assert lichess == []


@pytest.fixture
def tables_down(monkeypatch):
    async def down(fen: str) -> dict:
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(tablebase, "_fetch", down)


class _FakeEngine:
    """Движок-заглушка: оценка и главная линия — те, что задал тест."""

    def __init__(self, score: chess.engine.Score, pv: list[str]):
        self.score, self.pv, self.limits = score, pv, []

    def analyse(self, board, limit):
        self.limits.append(limit)
        return {"score": chess.engine.PovScore(self.score, board.turn), "pv": [chess.Move.from_uci(m) for m in self.pv]}


def _engine(monkeypatch, engine=None, busy=False):
    class Pool:
        @contextmanager
        def acquire(self):
            if busy:
                raise EngineBusyError("busy")
            yield engine

    monkeypatch.setattr(tablebase, "resolve_stockfish_path", lambda: "stockfish")
    monkeypatch.setattr(tablebase, "get_engine_pool", lambda path: Pool())


def test_engine_answers_when_tables_are_down(client, tables_down, monkeypatch):
    engine = _FakeEngine(chess.engine.Mate(9), ["b1b5"])
    _engine(monkeypatch, engine)
    response = client.post(API, json={"fen": KQK})
    assert response.status_code == 200
    assert response.json() == {"category": "win", "dtm": None, "dtz": None, "source": "engine",
                               "best": {"uci": "b1b5", "san": "Qb5+", "category": None, "dtm": None, "dtz": None}}
    assert engine.limits == [chess.engine.Limit(depth=tablebase.FALLBACK_DEPTH)]


def test_engine_answer_is_not_cached(client, tables_down, monkeypatch, lichess):
    _engine(monkeypatch, _FakeEngine(chess.engine.Mate(9), ["b1b5"]))
    monkeypatch.setattr(tablebase, "_fetch", _down_once(lichess))
    assert client.post(API, json={"fen": KQK}).json()["source"] == "engine"
    assert client.post(API, json={"fen": KQK}).json()["source"] == "tablebase"


def _down_once(calls: list[str]):
    """Первый запрос к таблицам падает по таймауту, следующие получают ответ таблиц."""

    async def fetch(fen: str) -> dict:
        calls.append(fen)
        if len(calls) == 1:
            raise httpx.ReadTimeout("slow")
        return LICHESS_ANSWER

    return fetch


def test_no_engine_either_is_503(client, tables_down, monkeypatch):
    monkeypatch.setattr(tablebase, "resolve_stockfish_path", lambda: None)
    response = client.post(API, json={"fen": KQK})
    assert response.status_code == 503 and response.json()["detail"]["code"] == "tablebase_unavailable"


def test_busy_engine_is_503_engine_busy(client, tables_down, monkeypatch):
    _engine(monkeypatch, busy=True)
    response = client.post(API, json={"fen": KQK})
    assert response.status_code == 503 and response.json()["detail"]["code"] == "engine_busy"


@pytest.mark.parametrize(("score", "category"), [
    (chess.engine.Mate(3), "win"), (chess.engine.Mate(-2), "loss"), (chess.engine.Mate(0), "loss"),
    (chess.engine.Cp(tablebase.ENGINE_WIN_CP), "win"), (chess.engine.Cp(-tablebase.ENGINE_WIN_CP), "loss"),
    (chess.engine.Cp(tablebase.ENGINE_DRAW_CP), "draw"), (chess.engine.Cp(0), "draw"),
    (chess.engine.Cp(tablebase.ENGINE_DRAW_CP + 1), "maybe-win"), (chess.engine.Cp(-200), "maybe-loss"),
])
def test_engine_category_thresholds(score, category):
    assert tablebase.engine_category(score) == category


async def test_closed_during_a_game_with_a_person(client, lichess, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=614, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(API, json={"fen": KQK}, headers={"Authorization": f"Bearer {token_user_1}"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_locked_in_game"
