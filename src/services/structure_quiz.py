"""
«Узнай структуру» (таск 27.9, тренажёр 19.1): позиция → название пешечной структуры из четырёх вариантов.

Позиции — из публичных партий библиотеки с разметкой 27.5: берётся полуход, где детектор видит ту же структуру, что
и у партии в целом. Если размеченных партий мало (пустая база, тесты) — добираются учебные «скелеты»: только короли и
пешки структуры. Движок не нужен.
"""

import random
from dataclasses import dataclass

import chess

from src.services import pawn_structures as ps

OPTIONS = 4

# Учебные скелеты: пешки белых и чёрных (как в тестах детектора), короли на g1 / g8.
SKELETONS: dict[str, tuple[str, str]] = {
    "hedgehog": ("a2 b2 c4 e4 f2 g2 h2", "a6 b6 d6 e6 f7 g7 h7"),
    "maroczy": ("a2 b2 c4 e4 f2 g2 h2", "a7 b7 d6 e7 f7 g6 h7"),
    "wedge": ("a2 b2 c4 d5 e4 f2 g2 h2", "a7 b7 c5 d6 e5 f7 g6 h7"),
    "kid_chain": ("a2 b2 c2 d5 e4 f2 g2 h2", "a7 b7 c7 d6 e5 f7 g6 h7"),
    "modern_benoni": ("a2 b2 d5 e4 f2 g2 h2", "a7 b7 c5 d6 f7 g6 h7"),
    "stonewall": ("a2 b2 c3 d4 e3 f4 g2 h2", "a7 b7 c6 d5 e6 f7 g7 h7"),
    "saw": ("a2 b2 c2 d4 f2 g2 h2", "a7 b7 c6 e6 f7 g7 h7"),
    "french_chain": ("a2 b2 c3 d4 e5 f2 g2 h2", "a7 b7 c7 d5 e6 f7 g7 h7"),
    "french_exchange": ("a2 b2 c2 d4 f2 g2 h2", "a7 b7 c7 d5 f7 g7 h7"),
    "carlsbad": ("a2 b2 d4 e3 f2 g2 h2", "a7 b7 c6 d5 f7 g7 h7"),
    "hanging_pawns": ("a2 c4 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7"),
    "isolated_pawn": ("a2 b2 d4 f2 g2 h2", "a7 b7 e6 f7 g7 h7"),
    "spanish": ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 c7 d6 f7 g7 h7"),
    "symmetry": ("a2 b2 c2 e4 f2 g2 h2", "a7 b7 c7 e5 f7 g7 h7"),
}


@dataclass(frozen=True)
class Question:
    fen: str
    answer: str
    options: list[str]
    game_id: int | None = None
    ply: int | None = None


def skeleton_fen(structure: str) -> str:
    board = chess.Board(None)
    board.set_piece_at(chess.G1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.G8, chess.Piece(chess.KING, chess.BLACK))
    for color, squares in zip((chess.WHITE, chess.BLACK), SKELETONS[structure], strict=True):
        for name in squares.split():
            board.set_piece_at(chess.parse_square(name), chess.Piece(chess.PAWN, color))
    return board.fen()


def position_with(moves: list[str], structure: str, rng: random.Random) -> tuple[str, int] | None:
    """Случайный полуход партии (в окне 27.5), где видна именно эта структура: FEN и номер полухода."""
    board = chess.Board()
    found: list[tuple[str, int]] = []
    for ply, uci in enumerate(moves, start=1):
        try:
            board.push(chess.Move.from_uci(uci))
        except (ValueError, AssertionError):
            break
        if ply > ps.LAST_PLY:
            break
        if ply >= ps.FIRST_PLY and ps.detect(board) == structure:
            found.append((board.fen(), ply))
    return rng.choice(found) if found else None


def options_for(answer: str, rng: random.Random) -> list[str]:
    others = rng.sample([s for s in ps.STRUCTURES if s != answer], OPTIONS - 1)
    options = [answer, *others]
    rng.shuffle(options)
    return options


def build(games: list[tuple[int, str, str]], count: int, rng: random.Random) -> list[Question]:
    """games — (id, structure, moves) из библиотеки; разные структуры подряд, недостающее — скелетами."""
    questions: list[Question] = []
    used: set[str] = set()
    for game_id, structure, moves in games:
        if len(questions) >= count:
            break
        if structure not in ps.STRUCTURES or (structure in used and len(used) < len(ps.STRUCTURES)):
            continue
        position = position_with(moves.split(), structure, rng)
        if position is None:
            continue
        used.add(structure)
        questions.append(Question(position[0], structure, options_for(structure, rng), game_id, position[1]))
    pool = [s for s in ps.STRUCTURES if s not in used] or list(ps.STRUCTURES)
    rng.shuffle(pool)
    while len(questions) < count:
        structure = pool[len(questions) % len(pool)]
        questions.append(Question(skeleton_fen(structure), structure, options_for(structure, rng)))
    return questions
