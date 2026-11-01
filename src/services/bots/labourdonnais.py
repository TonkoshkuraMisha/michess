# --- FILE: src/services/bots/labourdonnais.py ---

import chess
from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

LABOURDONNAIS_BLUNDER_GUARD_CP = 200.0

DEFAULT_LABOURDONNAIS_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 81, "Любимый ход Лабурдонне в атаке: открываем линии для фигур!"),
        ("d2d4", 16, "Ферзевый гамбит в стиле матчей с Мак-Доннеллом."),
        ("f2f4", 3, "Дебют Берда — фланговый зажим центра."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 86, "Гамбит Эванса! Жертвуем пешку ради стремительного захвата центра!"),
        ("c2c3", 14, "Тихая итальянская партия с подготовкой d2-d4."),
    ],
}

LABOURDONNAIS_OPENING_BOOK = load_bot_opening_book("labourdonnais", DEFAULT_LABOURDONNAIS_BOOK)


def evaluate_labourdonnais_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.is_castling(move):
        bonus += 38.0
        note = "Рокировка! Вводим ладью в бой и готовим решительный штурм."

    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 12:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 25.0
            note = "Быстро выводим фигуры в бой — каждый темп на счету!"
        if move.to_square in EXTENDED_CENTER:
            bonus += 18.0
            note = "Фигуры устремляются в центр для комбинационной атаки!"

    if move.to_square in CENTER_SQUARES:
        bonus += 22.0
        if not note:
            note = "Захватываем инициативу в центре в духе французской романтической школы!"

    if board_before.gives_check(move):
        bonus += 24.0
        note = "Шах! Не даём сопернику передышки!"
    elif board_before.is_capture(move):
        bonus += 14.0

    return bonus, note


class LabourdonnaisBot(HistoricalBot):
    """Луи-Шарль Маэ де Лабурдонне (~1650 UCI Эло, depth=5, skill=5)."""

    bot_id = "labourdonnais"
    engine_source_name = "labourdonnais_style_engine"
    default_comment = "Атака и комбинационный натиск в стиле «Кафе де ля Режанс»!"
    blunder_guard_cp = LABOURDONNAIS_BLUNDER_GUARD_CP
    jitter_range = 12.0
    multipv = 8
    opening_book = LABOURDONNAIS_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 5,
            uci_elo: int = 1650,
            search_depth: int = 5,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_labourdonnais_style_bonus(board_before, move)


labourdonnais_bot = LabourdonnaisBot()
