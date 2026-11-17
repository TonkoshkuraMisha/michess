"""
Шахматы Фишера (таск 21.3): случайная расстановка из 960, партия против бота. Правила (в том числе рокировка по
правилам 960) — `python-chess` в режиме chess960, бот — Stockfish с `UCI_Chess960` (python-chess включает опцию сам
по флагу доски) и ограничением силы через пул движка (правило 3). Клиент присылает номер расстановки и ходы с
начала партии: сервер переигрывает их, поэтому видит и повторения позиции. Без рейтинга и без хранения партии.

Рокировка в ходах — «король берёт свою ладью» (UCI режима 960, например e1h1), так её однозначно задать при любой
расстановке.
"""

import random
from dataclasses import dataclass

import chess
import chess.engine

from src.core.errors import DomainValueError
from src.services.bots.base import resolve_stockfish_path
from src.services.engine_pool import EngineUnavailableError, get_engine_pool

STANDARD_POSITION = 518
MAX_PLIES = 600
# Уровни бота: ограничение силы Stockfish (UCI_Elo не ниже 1320) и время на ход.
LEVELS: dict[int, tuple[int, float]] = {1: (1320, 0.05), 2: (1600, 0.1), 3: (1900, 0.15), 4: (2200, 0.25),
                                        5: (2600, 0.4)}


@dataclass
class Game:
    number: int
    board: chess.Board
    sans: list[str]


def start_board(number: int) -> chess.Board:
    if not 0 <= number <= 959:
        raise DomainValueError("chess960_bad_position")
    return chess.Board.from_chess960_pos(number)


def random_number(rng: random.Random | None = None) -> int:
    return (rng or random.Random()).randrange(960)


def replay(number: int, moves: list[str]) -> Game:
    """Партия с расстановки number по ходам UCI; нелегальный ход — ошибка с этим ходом."""
    board = start_board(number)
    sans: list[str] = []
    for uci in moves[:MAX_PLIES]:
        sans.append(push(board, uci))
    return Game(number, board, sans)


def push(board: chess.Board, uci: str) -> str:
    """
    Применяет ход игрока (запись UCI режима 960) и возвращает его SAN. Нелегальный ход или уже законченная партия —
    отказ.
    """
    if outcome(board)[0] is not None:
        raise DomainValueError("mini_game_over")
    try:
        move = board.parse_uci(uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=uci[:10]) from None
    san = board.san(move)
    board.push(move)
    return san


def outcome(board: chess.Board) -> tuple[str | None, str | None]:
    """
    Итог и причина: мат, пат, нехватка материала; троекратное повторение и 50 ходов — когда они уже случились
    (claim_draw в python-chess засчитал бы ничью на ход раньше: «следующим ходом можно повторить»).
    """
    result = board.outcome()
    if result is not None:
        return result.result(), result.termination.name.lower()
    if board.is_repetition(3):
        return "1/2-1/2", "threefold_repetition"
    if board.is_fifty_moves():
        return "1/2-1/2", "fifty_moves"
    return None, None


def bot_move(board: chess.Board, level: int) -> chess.Move:
    """Ход бота в партии Фишера: Stockfish из пула с ограничением силы и времени по уровню (LEVELS)."""
    elo, seconds = LEVELS.get(level, LEVELS[2])
    path = resolve_stockfish_path()
    if path is None:
        raise EngineUnavailableError("Stockfish path is not configured")
    with get_engine_pool(path).acquire({"UCI_LimitStrength": True, "UCI_Elo": elo}) as engine:
        played = engine.play(board, chess.engine.Limit(time=seconds))
    if played.move is None or played.move not in board.legal_moves:
        raise EngineUnavailableError("engine returned no legal move")
    return played.move
