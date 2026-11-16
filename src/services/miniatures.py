"""
«Миниатюры» (таск 27.9): короткие партии библиотеки, закончившиеся матом на доске. Упражнение — позиция перед
последним ходом: найти мат (засчитывается любой матующий ход). Движок не нужен: мат проверяет python-chess.
"""

import random
from dataclasses import dataclass

import chess

MAX_PLIES = 50  # до 25 ходов


@dataclass(frozen=True)
class Miniature:
    game_id: int
    fen: str
    moves: list[str]  # ходы партии до позиции задания
    answer: str  # ход партии (UCI)


def miniature(game_id: int, moves_text: str) -> Miniature | None:
    """Партия — миниатюра, если последний ход дал мат."""
    moves = moves_text.split()
    if not 2 <= len(moves) <= MAX_PLIES:
        return None
    board = chess.Board()
    try:
        for uci in moves[:-1]:
            board.push(chess.Move.from_uci(uci))
        last = chess.Move.from_uci(moves[-1])
    except (ValueError, AssertionError):
        return None
    if last not in board.legal_moves:
        return None
    fen = board.fen()
    board.push(last)
    if not board.is_checkmate():
        return None
    return Miniature(game_id, fen, moves[:-1], moves[-1])


def pick(rows: list[tuple[int, str]], count: int, rng: random.Random) -> list[Miniature]:
    found = [m for m in (miniature(game_id, moves) for game_id, moves in rows) if m is not None]
    rng.shuffle(found)
    return found[:count]
