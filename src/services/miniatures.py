"""
«Миниатюры» (таск 27.9): короткие партии библиотеки, закончившиеся матом на доске. Упражнение — позиция перед
последним ходом: найти мат (засчитывается любой матующий ход). Движок не нужен: мат проверяет python-chess.

Данные: таблица library_games. Отбор делает маршрут GET /library/miniatures (src/api/library.py): публичные партии
с обычной начальной позиции, с признаком mate_finish и не длиннее MAX_PLIES полуходов, в случайном порядке; этот
модуль перепроверяет каждую по ходам и строит задание. Ответ (ход партии) уходит клиенту — упражнение без рейтинга,
проверка на клиенте.
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
    """
    Партия — миниатюра, если последний ход дал мат. moves_text — ходы партии в UCI через пробел (library_games.moves).
    None — партия длиннее MAX_PLIES, короче двух полуходов, с нечитаемым или нелегальным ходом либо без мата в конце.
    """
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
    """Не больше count миниатюр из строк (id партии, ходы) в случайном порядке; rng с seed делает набор повторяемым."""
    found = [m for m in (miniature(game_id, moves) for game_id, moves in rows) if m is not None]
    rng.shuffle(found)
    return found[:count]
