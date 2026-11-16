"""Пешечные структуры (таск 27.5): правила по пешкам, зеркальные структуры, структура партии, метка в библиотеке."""

import chess
import pytest

from src.services import library
from src.services import pawn_structures as ps


def board(white: str, black: str) -> chess.Board:
    b = chess.Board(None)
    b.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    b.set_piece_at(chess.E8, chess.Piece(chess.KING, chess.BLACK))
    for color, squares in ((chess.WHITE, white), (chess.BLACK, black)):
        for name in squares.split():
            b.set_piece_at(chess.parse_square(name), chess.Piece(chess.PAWN, color))
    return b


@pytest.mark.parametrize(("white", "black", "expected"), [
    ("a2 b2 c4 e4 f2 g2 h2", "a6 b6 d6 e6 f7 g7 h7", "hedgehog"),
    ("a2 b2 c4 e4 f2 g2 h2", "a7 b7 d6 e7 f7 g6 h7", "maroczy"),
    ("a2 b2 c4 d5 e4 f2 g2", "a7 b7 c5 d6 e5 f7 g6", "wedge"),
    ("a2 b2 c2 d5 e4 f2 g2", "a7 b7 c7 d6 e5 f7 g6", "kid_chain"),
    ("a2 b2 d5 e4 f2 g2 h2", "a7 b7 c5 d6 f7 g6 h7", "modern_benoni"),
    ("a2 b2 c3 d4 e3 f4 g2", "a7 b7 c6 d5 e6 f7 g7", "stonewall"),
    ("a2 b2 c2 d4 f2 g2 h2", "a7 b7 c6 e6 f7 g7 h7", "saw"),
    ("a2 b2 c3 d4 e5 f2 g2", "a7 b7 c7 d5 e6 f7 g7", "french_chain"),
    ("a2 b2 c2 d4 f2 g2 h2", "a7 b7 c7 d5 f7 g7 h7", "french_exchange"),
    ("a2 b2 d4 e3 f2 g2 h2", "a7 b7 c6 d5 f7 g7 h7", "carlsbad"),
    ("a2 c4 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7", "hanging_pawns"),
    ("a2 b2 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7", "isolated_pawn"),
    ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 c7 d6 f7 g7 h7", "spanish"),
    ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 c7 e5 f7 g7 h7", "symmetry"),
    ("a2 b2 c2 d2 e2 f2 g2 h2", "a7 b7 c7 d7 e7 f7 g7 h7", None),
])
def test_rules(white, black, expected):
    assert ps.detect(board(white, black)) == expected


def test_mirrored_structure_for_black():
    # Изолированная пешка у чёрных (d5 без c/e), у белых d-пешки нет.
    assert ps.detect(board("a2 b2 e3 f2 g2 h2", "a7 b7 d5 f7 g7 h7")) == "isolated_pawn"
    # Каменная стена у чёрных: c6 d5 e6 f5.
    assert ps.detect(board("a2 b2 c4 d4 g2 h2", "a7 b7 c6 d5 e6 f5")) == "stonewall"


def test_game_structure_needs_a_lasting_structure():
    moves = []
    b = chess.Board()
    line = "e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 Bd7 b4 cxd4 cxd4 Rc8 Bb2 Nge7 Nc3 Nf5 Na4 Qd8 Bd3 Be7"
    for san in line.split(" "):
        moves.append(b.push_san(san))
    assert ps.game_structure(moves) == "french_chain"
    assert ps.game_structure(moves[:14]) is None  # меньше 8 полуходов в окне


def test_library_import_tags_structure():
    pgn = "1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Bd7 7. b4 cxd4 8. cxd4 Rc8 9. Bb2 Nge7 " \
          "10. Nc3 Nf5 11. Na4 Qd8 12. Bd3 Be7 *"
    parsed = library.parse_game(next(library.read_text(pgn)))
    assert library.structure_of(parsed) == "french_chain"
