from src.services.game_engine import engine


def test_process_valid_move():
    pgn = ""
    is_valid, new_pgn, result = engine.process_move(pgn, "e2e4")
    assert is_valid is True
    assert "1. e4" in new_pgn
    assert result is None


def test_process_illegal_move():
    pgn = ""
    is_valid, new_pgn, result = engine.process_move(pgn, "e2e5")
    assert is_valid is False
    assert new_pgn == ""
    assert result is None


def test_turn_sequence_and_notation():
    pgn = ""
    # White move
    is_valid_1, pgn_1, _ = engine.process_move(pgn, "e2e4")
    assert is_valid_1 is True

    # Black move
    is_valid_2, pgn_2, _ = engine.process_move(pgn_1, "e7e5")
    assert is_valid_2 is True
    assert "1. e4 e5" in pgn_2