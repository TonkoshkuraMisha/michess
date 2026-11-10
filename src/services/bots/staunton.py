# --- FILE: src/services/bots/staunton.py ---

import chess

from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

STAUNTON_BLUNDER_GUARD_CP = 110.0

DEFAULT_STAUNTON_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 82, "Классический открытый дебют в традициях лондонской школы."),
        ("c2c4", 12, "Английское начало (1. c4) — фирменное позиционное оружие Говарда Стаунтона!"),
        ("d2d4", 6, "Солидная закрытая игра ферзевой пешкой."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("c7c5", 52, "Сицилианская защита — любимый асимметричный ответ Стаунтона чёрными!"),
        ("e7e5", 38, "Классический симметричный ответ в центре."),
        ("e7e6", 10, "Французская защита для прочной позиционной борьбы."),
    ],
}

STAUNTON_OPENING_BOOK = load_bot_opening_book("staunton", DEFAULT_STAUNTON_BOOK)


def evaluate_staunton_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.is_castling(move):
        bonus += 40.0
        note = "Рокировка в духе английской классической школы: король в безопасности, ладья входит в игру."

    if piece.piece_type == chess.PAWN and board_before.fullmove_number <= 12:
        if move.to_square in {chess.C4, chess.C5}:
            bonus += 30.0
            note = "Берём под фланговый контроль центральный пункт по системе Стаунтона!"
        elif move.to_square in CENTER_SQUARES:
            bonus += 24.0
            note = "Укрепляем позиции в центре доски."

    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 12:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 26.0
            if not note:
                note = "Развиваем фигуры на стратегически важные поля."
        if move.to_square in EXTENDED_CENTER:
            bonus += 16.0

    if board_before.gives_check(move):
        bonus += 18.0
        if not note:
            note = "Тактический шах для перехвата инициативы."
    elif board_before.is_capture(move):
        bonus += 14.0

    return bonus, note


class StauntonBot(HistoricalBot):
    """Говард Стаунтон (~1750 UCI Эло, depth=6, skill=7)."""

    bot_id = "staunton"
    engine_source_name = "staunton_style_engine"
    default_comment = "Фундаментальная позиционная игра по канонам «The Chess-Player's Handbook»."
    blunder_guard_cp = STAUNTON_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = STAUNTON_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 7,
            uci_elo: int = 1750,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_staunton_style_bonus(board_before, move)


staunton_bot = StauntonBot()
