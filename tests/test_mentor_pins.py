import chess

from src.services.mentor_service import _is_defended, _overloaded


def test_pinned_defender_does_not_defend():
    # Слон d5 «защищён» конём e3, но конь связан ладьёй e8 с королём e1.
    board = chess.Board("4r2k/8/1n6/3B4/8/4N3/8/4K3 w - - 0 1")
    assert not _is_defended(board, chess.D5)


def test_pinned_piece_defends_along_the_pin_line():
    # Ладья e3 связана ладьёй e8, но защищает коня e5 на той же вертикали.
    board = chess.Board("4r2k/8/3n4/4N3/8/4R3/8/4K3 w - - 0 1")
    assert _is_defended(board, chess.E5)


def test_free_defender_defends():
    board = chess.Board("4k3/8/1n6/3B4/4P3/8/8/4K3 w - - 0 1")
    assert _is_defended(board, chess.D5)


def test_pinned_second_defender_does_not_hide_an_overload():
    # Конь d4 — единственный настоящий защитник ладьи b3 (бьёт ладья b8) и слона f5 (бьёт ладья f8). Слон e4 тоже
    # смотрит на f5, но связан ладьёй e8 с королём e1 и защищать не может: конь d4 перегружен.
    board = chess.Board("1r2rr1k/8/8/5B2/3NB3/1R6/8/4K3 b - - 0 1")
    assert any(m.square == chess.D4 for m in _overloaded(board))
