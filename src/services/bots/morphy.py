# --- FILE: src/services/bots/morphy.py ---

import chess
from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

MORPHY_BLUNDER_GUARD_CP = 150.0

DEFAULT_MORPHY_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 94, "Открытая игра 1. e4! — основа шахматной эстетики Пола Морфи."),
        ("d2d4", 6, "Закрытый дебют для разнообразия матчевой борьбы."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 82, "Гамбит Эванса! Жертвуем пешку ради выигрыша темпа и захвата центра c3-d4!"),
        ("c2c3", 12, "Подготовка мощного пешечного прорыва d2-d4."),
        ("e1g1", 6, "Немедленная рокировка для скорейшего ввода ладьи по линии «e»."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": [
        ("d2d4", 100, "Как в Оперной партии 1858 года: немедленно вскрываем центр ходом d2-d4!"),
    ],
}

MORPHY_OPENING_BOOK = load_bot_opening_book("morphy", DEFAULT_MORPHY_BOOK)


def evaluate_morphy_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.is_castling(move):
        bonus += 45.0
        note = "Рокировка! Уводим короля в безопасность и подключаем ладью к борьбе за открытые линии."

    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 14:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 32.0
            note = "Каждая фигура должна вступить в бой! Быстрое развитие — секрет сокрушительной атаки."
        if move.to_square in EXTENDED_CENTER:
            bonus += 18.0
            if not note:
                note = "Размещаем фигуры в центре на идеальных ударных позициях!"

    if piece.piece_type == chess.ROOK:
        to_file = chess.square_file(move.to_square)
        if to_file in (3, 4):
            bonus += 26.0
            note = "Ладья занимает центральную вертикаль для решающего вторжения!"

    if move.to_square in CENTER_SQUARES:
        bonus += 24.0
        if not note:
            note = "Вскрываем центр, чтобы дать простор нашим слонам и ладьям!"

    if board_before.gives_check(move):
        bonus += 28.0
        note = "Шах с выигрышем темпа! Не даём сопернику времени перевести дух."
    elif board_before.is_capture(move):
        bonus += 16.0
        if not note:
            note = "Устраняем защитника и вскрываем линии для фигурной атаки!"

    return bonus, note


class MorphyBot(HistoricalBot):
    """Пол Морфи (~1850 UCI Эло, depth=6, skill=8)."""

    bot_id = "morphy"
    engine_source_name = "morphy_style_engine"
    default_comment = "Гармоничная мобилизация всех сил и давление по открытым линиям в стиле Пола Морфи!"
    blunder_guard_cp = MORPHY_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 8
    opening_book = MORPHY_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 8,
            uci_elo: int = 1850,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_morphy_style_bonus(board_before, move)


morphy_bot = MorphyBot()
