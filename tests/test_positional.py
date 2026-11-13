# --- FILE: tests/test_positional.py ---
"""Позиционные признаки и идеи ходов для наставника (таск B.4)."""

import chess

from src.services.coach import advice_for_position
from src.services.positional import is_outpost, move_idea, positional_features


def codes(fen: str) -> list[str]:
    board = chess.Board(fen)
    return [f.code for f in positional_features(board, board.turn)]


def test_king_in_the_centre_in_the_middlegame():
    # 10-й ход, ферзи на доске, белый король на e1 не рокировал.
    assert codes("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 10")[0] == "king_center"


def test_passed_pawns_own_and_enemy():
    assert "passed_own" in codes("4k3/8/8/3P4/8/8/8/4K3 w - - 0 40")
    found = codes("4k3/8/8/8/3p4/8/8/4K3 w - - 0 40")
    assert "passed_enemy" in found and "king_active" in found


def test_blockaded_enemy_passer_is_not_named():
    assert "passed_enemy" not in codes("4k3/8/8/8/3p4/3N4/8/4K3 w - - 0 40")


def test_open_file_for_a_rook():
    board = chess.Board("4k3/pp3ppp/8/8/8/8/PP3PPP/R3K3 w - - 0 25")
    feature = next(f for f in positional_features(board, chess.WHITE) if f.code == "open_file")
    assert feature.params == {"file": "d"}


def test_outpost_is_protected_and_safe_from_pawns():
    # d5 защищено пешкой e4; пешка c7 соперника ещё может прийти на c6 и прогнать коня.
    assert not is_outpost(chess.Board("4k3/1pp3pp/8/8/4P3/2N5/PP3PPP/4K3 w - - 0 25"), chess.D5, chess.WHITE)
    # Пешек на c и e у соперника нет — d5 опорный пункт.
    board = chess.Board("4k3/6pp/8/8/4P3/2N5/PP3PPP/4K3 w - - 0 25")
    assert is_outpost(board, chess.D5, chess.WHITE)
    # Без защиты своей пешкой — не опорный пункт.
    assert not is_outpost(board, chess.C5, chess.WHITE)
    assert move_idea(board, chess.Move.from_uci("c3d5")).code == "outpost"


def test_isolated_enemy_pawn_and_doubled_own():
    found = codes("4k3/pp3ppp/8/3p4/8/2P5/P1P2PPP/4K3 w - - 0 25")
    assert "isolated_enemy" in found and "doubled_own" in found


def test_bad_bishop():
    # Белые пешки на тёмных полях d4, e5, c3 (заблокированы), слон c1 тёмнопольный.
    board = chess.Board("4k3/8/2p1p3/2PpP3/3P4/8/8/2B1K3 w - - 0 30")
    assert any(f.code == "bad_bishop" for f in positional_features(board, chess.WHITE))


def test_move_ideas():
    board = chess.Board("4k3/pp3ppp/8/8/8/8/PP3PPP/R3K3 w - - 0 25")
    assert move_idea(board, chess.Move.from_uci("a1d1")).code == "open_file"
    castle = chess.Board("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1")
    assert move_idea(castle, chess.Move.from_uci("e1g1")).code == "castle"
    ending = chess.Board("4k3/8/8/8/8/8/4P3/4K3 w - - 0 50")
    assert move_idea(ending, chess.Move.from_uci("e1d2")).code == "king_active"
    assert move_idea(ending, chess.Move.from_uci("e2e4")).code == "passed_push"


def test_quiet_position_gets_a_positional_sentence():
    advice = advice_for_position(chess.Board("4k3/pp3ppp/8/8/8/8/PP3PPP/R3K3 w - - 0 25"), None)
    keys = [s["key"].rsplit(".", 1)[0] for s in advice["comment"]]
    assert keys == ["coach.advice.pos_king_active"]
