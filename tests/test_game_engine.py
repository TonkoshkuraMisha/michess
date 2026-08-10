# --- FILE: tests/test_game_engine.py ---

from src.services.game_engine import engine

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def test_process_valid_move():
    is_valid, data = engine.process_move(STARTING_FEN, "e2e4")

    assert is_valid is True
    assert data is not None
    assert data["san"] == "e4"
    assert data["uci"] == "e2e4"
    assert "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR" in data["new_fen"]
    assert data["result"] is None
    assert data["is_game_over"] is False


def test_process_illegal_move():
    is_valid, data = engine.process_move(STARTING_FEN, "e2e5")

    assert is_valid is False
    assert data is None


def test_checkmate_detection():
    # Позиция за шаг до детского мата (ход белых: Qf7#)
    fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 3"
    is_valid, data = engine.process_move(fen, "f3f7")

    assert is_valid is True
    assert data["is_game_over"] is True
    assert data["result"] == "1-0"
    assert data["termination"] == "checkmate"