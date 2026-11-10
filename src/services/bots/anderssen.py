# --- FILE: src/services/bots/anderssen.py ---

import chess

from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    HistoricalBot,
    load_bot_opening_book,
)

ANDERSSEN_BLUNDER_GUARD_CP = 220.0

DEFAULT_ANDERSSEN_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 96, "Бриллиантовый гамбит Андерсена (в партиях: 373 раз(а))."),
        ("a2a3", 2, "Дебют Андерсена (1. a3!) — оригинальная идея из матча с Морфи 1858 года."),
        ("d2d4", 1, "Закрытое начало для позиционной борьбы."),
        ("f2f4", 1, "Дебют Берда — фланговая атака с первого хода."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 97, "Гамбит Эванса — любимое оружие Андерсена из «Неувядаемой партии»!"),
        ("e1g1", 2, "Быстрая рокировка с подготовкой атаки в центре."),
        ("c2c3", 1, "Классическая итальянская партия."),
    ],
}

ANDERSSEN_OPENING_BOOK = load_bot_opening_book("anderssen", DEFAULT_ANDERSSEN_BOOK)


def evaluate_anderssen_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if board_before.gives_check(move):
        bonus += 36.0
        note = "Шах! В духе «Бессмертной партии» — ни одного темпа передышки королю соперника!"

    if board_before.is_capture(move):
        bonus += 24.0
        if not note:
            note = "Вскрываем линии и устраняем защитные редуты неприятеля!"

    if board_before.is_castling(move):
        bonus += 38.0
        note = "Рокировка! Подключаем ладью к решающему штурму."

    if piece.piece_type in {chess.KNIGHT, chess.BISHOP} and board_before.fullmove_number <= 14:
        back_rank = 0 if board_before.turn == chess.WHITE else 7
        if chess.square_rank(move.from_square) == back_rank:
            bonus += 28.0
            if not note:
                note = "Мобилизуем лёгкие фигуры для комбинационного удара!"
        if move.to_square in EXTENDED_CENTER:
            bonus += 18.0

    if move.to_square in CENTER_SQUARES:
        bonus += 22.0
        if not note:
            note = "Борьба за инициативу и центральные диагонали!"

    return bonus, note


class AnderssenBot(HistoricalBot):
    """Адольф Андерсен (~1820 UCI Эло, depth=6, skill=8)."""

    bot_id = "anderssen"
    engine_source_name = "anderssen_style_engine"
    default_comment = "Блестящий комбинационный натиск в духе «Бессмертной» и «Неувядаемой» партий!"
    blunder_guard_cp = ANDERSSEN_BLUNDER_GUARD_CP
    jitter_range = 10.0
    multipv = 8
    opening_book = ANDERSSEN_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 8,
            uci_elo: int = 1820,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_anderssen_style_bonus(board_before, move)


anderssen_bot = AnderssenBot()
