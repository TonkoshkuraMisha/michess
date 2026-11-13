import chess

from src.services.mentor_service import _is_defended


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
