"""Шахматы Фишера (таск 21.3): расстановки, рокировка 960, итоги, ход бота через пул движка (движок подменён)."""

from contextlib import contextmanager
from types import SimpleNamespace

import chess
import pytest

from src.core.errors import DomainValueError
from src.services import chess960 as c960

API = "/api/v1/chess960"


def test_start_positions_and_castling_rules():
    assert c960.start_board(518).fen() == chess.STARTING_FEN
    board = c960.start_board(0)
    assert board.chess960 and board.board_fen() == "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR"
    with pytest.raises(DomainValueError):
        c960.start_board(960)
    # Рокировка в 960 — «король берёт свою ладью». Расстановка 709 (RKBBQNNR): король b1 и ладья a1 → король c1,
    # ладья d1 (длинная рокировка — король идёт вправо).
    game = c960.replay(709, ["e2e3", "e7e6", "d1e2", "d8e7", "d2d3", "d7d6", "c1d2", "c8d7", "b1a1"])
    assert game.sans[-1] == "O-O-O"
    assert game.board.piece_at(chess.C1).piece_type == chess.KING and game.board.piece_at(chess.D1).piece_type == chess.ROOK
    with pytest.raises(DomainValueError) as illegal:
        c960.replay(0, ["e2e5"])
    assert illegal.value.code == "illegal_move"


def test_outcome_by_mate_and_repetition():
    mate = c960.replay(518, ["f2f3", "e7e5", "g2g4", "d8h4"])
    assert c960.outcome(mate.board) == ("0-1", "checkmate")
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"] * 2
    assert c960.outcome(c960.replay(518, shuffle).board) == ("1/2-1/2", "threefold_repetition")
    with pytest.raises(DomainValueError):
        c960.push(mate.board, "e1e2")


def test_bot_move_uses_the_pool_with_limited_strength(monkeypatch):
    seen = {}

    @contextmanager
    def acquire(options):
        seen["options"] = options

        def play(board, limit):
            seen["chess960"], seen["time"] = board.chess960, limit.time
            return SimpleNamespace(move=next(iter(board.legal_moves)))

        yield SimpleNamespace(play=play)

    monkeypatch.setattr(c960, "resolve_stockfish_path", lambda: "stockfish")
    monkeypatch.setattr(c960, "get_engine_pool", lambda path: SimpleNamespace(acquire=acquire))
    board = c960.start_board(100)
    assert c960.bot_move(board, 4) in board.legal_moves
    assert seen == {"options": {"UCI_LimitStrength": True, "UCI_Elo": 2200}, "chess960": True, "time": 0.25}


def test_api_game_flow(client, monkeypatch):
    monkeypatch.setattr(c960, "bot_move", lambda board, level: next(iter(board.legal_moves)))
    new = client.get(f"{API}/new", params={"number": 0}).json()
    assert new["number"] == 0 and new["moves"] == [] and new["fen"].startswith("bbqnnrkr/")
    assert 0 <= client.get(f"{API}/new").json()["number"] <= 959

    after = client.post(f"{API}/move", json={"number": 0, "moves": [], "move": "g2g3", "level": 1}).json()
    assert after["moves"][0] == "g2g3" and len(after["moves"]) == 2 and after["bot_move"] == after["moves"][1]
    assert after["sans"][0] == "g3" and after["result"] is None

    first = client.post(f"{API}/bot-move", json={"number": 0, "moves": []}).json()
    assert len(first["moves"]) == 1 and first["bot_move"] == first["moves"][0]

    bad = client.post(f"{API}/move", json={"number": 0, "moves": [], "move": "e2e5"})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "illegal_move"
    over = client.post(f"{API}/move", json={"number": 518, "moves": ["f2f3", "e7e5", "g2g4", "d8h4"], "move": "e1f2"})
    assert over.json()["detail"]["code"] == "mini_game_over"
    assert client.get(f"{API}/new", params={"number": 960}).status_code == 422


def test_api_engine_unavailable(client, monkeypatch):
    def broken(board, level):
        raise c960.EngineUnavailableError("no engine")

    monkeypatch.setattr(c960, "bot_move", broken)
    reply = client.post(f"{API}/move", json={"number": 518, "moves": [], "move": "e2e4"})
    assert reply.status_code == 503 and reply.json()["detail"]["code"] == "engine_busy"
