# --- FILE: src/services/bots/paulsen.py ---

import chess

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
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

DEFAULT_PAULSEN_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 90, "paulsen.bookE4"),
        ("d2d4", 6, "paulsen.bookD4"),
        ("c2c4", 4, "paulsen.bookFlank"),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("c7c5", 48, "paulsen.bookSicilian"),
        ("e7e5", 38, "paulsen.bookE5"),
        ("e7e6", 10, "paulsen.bookFrench"),
        ("d7d6", 4, "paulsen.bookPirc"),
    ],
}

PAULSEN_OPENING_BOOK = load_bot_opening_book("paulsen", DEFAULT_PAULSEN_BOOK)


PAULSEN_STYLE = Style(
    "paulsen",
    Rule(CASTLING, 40.0, "paulsen.castle"),
    Group(
        piece(chess.PAWN) & by_move(14),
        FirstOf(
            Rule(
                to({chess.C5, chess.E6, chess.D6, chess.A6, chess.B6, chess.G6}), 24.0,
                "paulsen.structure",
            ),
            Rule(to(CENTER_SQUARES), 20.0, "paulsen.center"),
        ),
    ),
    Group(
        piece(chess.BISHOP),
        FirstOf(
            Rule(
                to({chess.G2, chess.B2, chess.G7, chess.B7, chess.E2, chess.E7}), 26.0,
                "paulsen.bishop",
            ),
            Rule(to(EXTENDED_CENTER), 18.0),
        ),
    ),
    Rule(piece(chess.KNIGHT) & to(EXTENDED_CENTER), 16.0, "paulsen.knightCenter", Note.FILL),
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
    default_comment = "paulsen.default"
    blunder_guard_cp = PAULSEN_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = PAULSEN_OPENING_BOOK
    style = PAULSEN_STYLE
    default_skill_level = 8
    default_uci_elo = 2080


paulsen_bot = PaulsenBot()
