# --- FILE: src/services/bots/philidor.py ---

import chess

from src.services.bots.base import (
    PIECE_VALUES,
    HistoricalBot,
    _simulate_human_thinking_time,
    analyse_with_stockfish,
    load_bot_opening_book,
    normalize_fen_key,
    resolve_stockfish_path,
    static_board_eval_cp,
)
from src.services.bots.style import (
    ALWAYS,
    CENTER_SQUARES,
    EXTENDED_CENTER,
    FirstOf,
    Group,
    Rule,
    Style,
    by_move,
    pawn_structure_delta,
    piece,
    piece_on,
    side,
    to,
)

PHILIDOR_BLUNDER_GUARD_CP = 120.0
BLUNDER_GUARD_MARGIN_CP = PHILIDOR_BLUNDER_GUARD_CP

DEFAULT_PHILIDOR_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 92, "Пешка короля открывает путь слону и занимает центр (11 партий)."),
        ("d2d4", 8, "Атака ферзевой пешкой с последующим c2-c4."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 72, "Встретим пешку соперника в центре: e7-e5 (8 партий)."),
        ("c7c5", 18, "Асимметричный фланговый ответ c7-c5 (3 партии)."),
        ("e7e6", 10, "Сдержанное построение e7-e6, готовя удар d7-d5."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq -": [
        ("f7f5", 65, "Контрудар f7-f5! Как я писал в «Анализе шахматной игры», перехватим инициативу пешками."),
        ("e5d4", 35, "Разменяем центральную пешку, удерживая прочный редут на d6."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Сначала c2-c3! Конь никогда не должен становиться впереди пешки c."),
    ],
}

PHILIDOR_OPENING_BOOK = load_bot_opening_book("philidor", DEFAULT_PHILIDOR_BOOK)
# Гарантируем, что классическая защита Филидора 1.e4 e5 2.Nf3 d6 всегда имеет приоритет
PHILIDOR_OPENING_BOOK["rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -"] = [
    ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
]


WHITE_PAWN = chess.Piece(chess.PAWN, chess.WHITE)
BLACK_PAWN = chess.Piece(chess.PAWN, chess.BLACK)

PHILIDOR_STYLE = Style(
    "philidor",
    Group(
        piece(chess.PAWN),
        Rule(ALWAYS, 14.0),
        FirstOf(
            Rule(to(CENTER_SQUARES), 35.0, "Пешки — душа шахмат! Мощный удар в центр доски."),
            Rule(to(EXTENDED_CENTER), 22.0, "Занимаем пространство пешечной фалангой."),
            Rule(
                to({chess.C3, chess.C6, chess.D3, chess.D6}), 16.0,
                "Подготавливаем продвижение центральной пешки по методу Филидора.",
            ),
        ),
    ),
    # «Конь не должен становиться впереди пешки c»: штраф за Nc3/Nf3 (Nc6/Nf6), пока пешка не пошла.
    Group(
        piece(chess.KNIGHT) & by_move(10) & side(chess.WHITE),
        Rule(to({chess.C3}) & piece_on(chess.C2, WHITE_PAWN), -55.0),
        Rule(to({chess.F3}) & piece_on(chess.F2, WHITE_PAWN), -45.0),
    ),
    Group(
        piece(chess.KNIGHT) & by_move(10) & side(chess.BLACK),
        Rule(to({chess.C6}) & piece_on(chess.C7, BLACK_PAWN), -55.0),
        Rule(to({chess.F6}) & piece_on(chess.F7, BLACK_PAWN), -45.0),
    ),
    Rule(ALWAYS, pawn_structure_delta),
)
evaluate_philidor_style_bonus = PHILIDOR_STYLE.evaluate


class PhilidorBot(HistoricalBot):
    """Франсуа-Андре Филидор (~1850 Эло, depth=6, skill=7)."""

    bot_id = "philidor"
    engine_source_name = "philidor_style_engine_deep"
    default_comment = "Пешки — душа шахмат. Строим несокрушимую пешечную цепь."
    blunder_guard_cp = PHILIDOR_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 6
    opening_book = PHILIDOR_OPENING_BOOK
    style = PHILIDOR_STYLE


philidor_bot = PhilidorBot()

__all__ = [
    "CENTER_SQUARES",
    "EXTENDED_CENTER",
    "PIECE_VALUES",
    "PHILIDOR_OPENING_BOOK",
    "PhilidorBot",
    "philidor_bot",
    "evaluate_philidor_style_bonus",
    "analyse_with_stockfish",
    "normalize_fen_key",
    "resolve_stockfish_path",
    "static_board_eval_cp",
    "_simulate_human_thinking_time",
]
