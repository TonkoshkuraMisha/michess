# --- FILE: src/services/bots/staunton.py ---

import chess

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.style import (
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    FROM_BACK_RANK,
    MINOR_PIECES,
    FirstOf,
    Group,
    Note,
    Rule,
    Style,
    by_move,
    piece,
    to,
)

STAUNTON_BLUNDER_GUARD_CP = 110.0

DEFAULT_STAUNTON_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 82, "staunton.bookE4"),
        ("c2c4", 12, "staunton.bookC4"),
        ("d2d4", 6, "staunton.bookD4"),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("c7c5", 52, "staunton.bookSicilian"),
        ("e7e5", 38, "staunton.bookE5"),
        ("e7e6", 10, "staunton.bookFrench"),
    ],
}

STAUNTON_OPENING_BOOK = load_bot_opening_book("staunton", DEFAULT_STAUNTON_BOOK)


STAUNTON_STYLE = Style(
    "staunton",
    Rule(
        CASTLING, 40.0,
        "staunton.castle",
    ),
    Group(
        piece(chess.PAWN) & by_move(12),
        FirstOf(
            Rule(to({chess.C4, chess.C5}), 30.0, "staunton.flankControl"),
            Rule(to(CENTER_SQUARES), 24.0, "staunton.center"),
        ),
    ),
    Group(
        piece(*MINOR_PIECES) & by_move(12),
        Rule(FROM_BACK_RANK, 26.0, "staunton.develop", Note.FILL),
        Rule(to(EXTENDED_CENTER), 16.0),
    ),
    FirstOf(
        Rule(CHECK, 18.0, "staunton.check", Note.FILL),
        Rule(CAPTURE, 14.0),
    ),
)
evaluate_staunton_style_bonus = STAUNTON_STYLE.evaluate


class StauntonBot(HistoricalBot):
    """Говард Стаунтон (~1750 UCI Эло, depth=6, skill=7)."""

    bot_id = "staunton"
    engine_source_name = "staunton_style_engine"
    default_comment = "staunton.default"
    blunder_guard_cp = STAUNTON_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = STAUNTON_OPENING_BOOK
    style = STAUNTON_STYLE
    default_skill_level = 7
    default_uci_elo = 2000


staunton_bot = StauntonBot()
