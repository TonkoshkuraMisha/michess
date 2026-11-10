# --- FILE: src/services/bots/zukertort.py ---

import chess

from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

ZUKERTORT_BLUNDER_GUARD_CP = 140.0

DEFAULT_ZUKERTORT_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 72, "Открытая игра с последующим комбинационным штурмом."),
        ("g1f3", 16, "Дебют Цукерторта (1. Nf3!) — гибкое развитие с сохранением выбора плана в центре!"),
        ("d2d4", 12, "Закрытое начало с переходом в систему Цукерторта (d4, Nf3, e3, Bd3, b3)."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 75, "Классический открытый бой 1...e5."),
        ("c7c5", 15, "Сицилианская защита."),
        ("e7e6", 10, "Французская защита."),
    ],
}

ZUKERTORT_OPENING_BOOK = load_bot_opening_book("zukertort", DEFAULT_ZUKERTORT_BOOK)


def evaluate_zukertort_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.is_castling(move):
        bonus += 40.0
        note = "Рокировка! Завершаем развитие и готовим тактический прорыв."

    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 14:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 28.0
            note = "Гибкое развитие фигур по системе Цукерторта."
        if move.to_square in EXTENDED_CENTER:
            bonus += 18.0

    if move.to_square in CENTER_SQUARES:
        bonus += 22.0
        if not note:
            note = "Энергичный захват ключевых центральных полей!"

    if board_before.gives_check(move):
        bonus += 26.0
        note = "Шах! Переходим к решительной комбинационной атаке в стиле Лондонского турнира 1883 года!"
    elif board_before.is_capture(move):
        bonus += 16.0

    return bonus, note


class ZukertortBot(HistoricalBot):
    """Иоганн Цукерторт (~1840 UCI Эло, depth=6, skill=8)."""

    bot_id = "zukertort"
    engine_source_name = "zukertort_style_engine"
    default_comment = "Тонкий стратегический манёвр с подготовкой комбинационного взрыва в стиле Цукерторта!"
    blunder_guard_cp = ZUKERTORT_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 8
    opening_book = ZUKERTORT_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 8,
            uci_elo: int = 1840,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_zukertort_style_bonus(board_before, move)


zukertort_bot = ZukertortBot()
