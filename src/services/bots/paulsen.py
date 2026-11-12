# --- FILE: src/services/bots/paulsen.py ---

import chess

from src.services.bots.base import HistoricalBot, load_bot_opening_book
from src.services.bots.style import (
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    FirstOf,
    Group,
    Note,
    Rule,
    Style,
    by_move,
    piece,
    to,
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


PAULSEN_STYLE = Style(
    "paulsen",
    Rule(CASTLING, 40.0, "Уводим короля в надёжное укрытие — фундамент глубокой защиты Паульсена."),
    Group(
        piece(chess.PAWN) & by_move(14),
        FirstOf(
            Rule(
                to({chess.C5, chess.E6, chess.D6, chess.A6, chess.B6, chess.G6}), 24.0,
                "Выстраиваем гибкую и неуязвимую оборонительную структуру по системе Паульсена!",
            ),
            Rule(to(CENTER_SQUARES), 20.0, "Укрепляем центральные устои позиции."),
        ),
    ),
    Group(
        piece(chess.BISHOP),
        FirstOf(
            Rule(
                to({chess.G2, chess.B2, chess.G7, chess.B7, chess.E2, chess.E7}), 26.0,
                "Развиваем слона на дальнобойную позицию — два слона определят исход борьбы!",
            ),
            Rule(to(EXTENDED_CENTER), 18.0),
        ),
    ),
    Rule(piece(chess.KNIGHT) & to(EXTENDED_CENTER), 16.0, "Гармоничная централизация коня.", Note.FILL),
    FirstOf(
        Rule(CHECK, 18.0),
        Rule(CAPTURE, 14.0),
    ),
)
evaluate_paulsen_style_bonus = PAULSEN_STYLE.evaluate


class PaulsenBot(HistoricalBot):
    """Луи Паульсен (~1800 UCI Эло, depth=6, skill=8)."""

    bot_id = "paulsen"
    engine_source_name = "paulsen_style_engine"
    default_comment = "Глубокий профилактический манёвр и укрепление позиции в стиле Луи Паульсена."
    blunder_guard_cp = PAULSEN_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = PAULSEN_OPENING_BOOK
    style = PAULSEN_STYLE
    default_skill_level = 8
    default_uci_elo = 1800


paulsen_bot = PaulsenBot()
