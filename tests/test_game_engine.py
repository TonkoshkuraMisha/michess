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


def test_underpromotion_to_knight_and_rook():
    """Проверка превращения пешки в коня (a7a8n) и ладью (a7a8r) с корректной записью SAN."""
    promotion_fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1"

    is_valid_n, res_knight = engine.process_move(promotion_fen, "a7a8n")
    assert is_valid_n is True
    assert res_knight["uci"] == "a7a8n"
    assert res_knight["san"].startswith("a8=N")

    is_valid_r, res_rook = engine.process_move(promotion_fen, "a7a8r")
    assert is_valid_r is True
    assert res_rook["uci"] == "a7a8r"
    assert res_rook["san"].startswith("a8=R")


def _play(moves: list[str]) -> list[dict]:
    """Проигрывает ходы через engine.process_move, передавая FEN и PGN, как это делает сервер."""
    fen, pgn, results = STARTING_FEN, "", []
    for mv in moves:
        is_valid, data = engine.process_move(fen, mv, pgn)
        assert is_valid, f"move {mv} rejected"
        fen, pgn = data["new_fen"], data["new_pgn"]
        results.append(data)
    return results


def test_threefold_repetition_ends_game():
    """Третье повторение позиции завершает партию ничьей (раньше не детектировалось: доска строилась из FEN)."""
    dance = ["g1f3", "g8f6", "f3g1", "f6g8"]
    results = _play(dance * 2)

    assert all(not r["is_game_over"] for r in results[:-1])
    last = results[-1]
    assert last["is_game_over"] is True
    assert last["termination"] == "repetition"
    assert last["result"] == "1/2-1/2"


def test_repetition_not_ended_when_only_reachable():
    """Позиция, из которой повторение лишь достижимо следующим ходом, партию не завершает."""
    results = _play(["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"])
    assert results[-1]["is_game_over"] is False


def test_inconsistent_pgn_falls_back_to_fen():
    """Если PGN не соответствует FEN, ход валидируется по FEN, как раньше."""
    is_valid, data = engine.process_move(STARTING_FEN, "e2e4", "1. d4 d5")
    assert is_valid is True
    assert data["san"] == "e4"
