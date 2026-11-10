# --- FILE: src/services/bots/paulsen.py ---

import chess

from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

PAULSEN_BLUNDER_GUARD_CP = 110.0

DEFAULT_PAULSEN_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 90, "Открытое начало с переходом в венскую или шотландскую систему Паульсена."),
        ("d2d4", 6, "Позиционная игра ферзевой пешкой."),
        ("c2c4", 4, "Фланговое развитие с гибким контролем центра."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("c7c5", 48, "Сицилианская защита (система Паульсена) — гибкая пружина для контратаки!"),
        ("e7e5", 38, "Классический ответ 1...e5."),
        ("e7e6", 10, "Французская защита."),
        ("d7d6", 4, "Гипермодернистская защита Пирца-Уфимцева, предвосхищённая Паульсеном!"),
    ],
}

PAULSEN_OPENING_BOOK = load_bot_opening_book("paulsen", DEFAULT_PAULSEN_BOOK)


def evaluate_paulsen_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.is_castling(move):
        bonus += 40.0
        note = "Уводим короля в надёжное укрытие — фундамент глубокой защиты Паульсена."

    if piece.piece_type == chess.PAWN and board_before.fullmove_number <= 14:
        if move.to_square in {chess.C5, chess.E6, chess.D6, chess.A6, chess.B6, chess.G6}:
            bonus += 24.0
            note = "Выстраиваем гибкую и неуязвимую оборонительную структуру по системе Паульсена!"
        elif move.to_square in CENTER_SQUARES:
            bonus += 20.0
            note = "Укрепляем центральные устои позиции."

    if piece.piece_type == chess.BISHOP:
        if move.to_square in {chess.G2, chess.B2, chess.G7, chess.B7, chess.E2, chess.E7}:
            bonus += 26.0
            note = "Развиваем слона на дальнобойную позицию — два слона определят исход борьбы!"
        elif move.to_square in EXTENDED_CENTER:
            bonus += 18.0

    if piece.piece_type == chess.KNIGHT and move.to_square in EXTENDED_CENTER:
        bonus += 16.0
        if not note:
            note = "Гармоничная централизация коня."

    if board_before.gives_check(move):
        bonus += 18.0
    elif board_before.is_capture(move):
        bonus += 14.0

    return bonus, note


class PaulsenBot(HistoricalBot):
    """Луи Паульсен (~1800 UCI Эло, depth=6, skill=8)."""

    bot_id = "paulsen"
    engine_source_name = "paulsen_style_engine"
    default_comment = "Глубокий профилактический манёвр и укрепление позиции в стиле Луи Паульсена."
    blunder_guard_cp = PAULSEN_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = PAULSEN_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 8,
            uci_elo: int = 1800,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_paulsen_style_bonus(board_before, move)


paulsen_bot = PaulsenBot()
