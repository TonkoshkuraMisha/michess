# --- FILE: src/services/bots/morphy.py ---

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
    to_file,
)

MORPHY_BLUNDER_GUARD_CP = 150.0

DEFAULT_MORPHY_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 94, "morphy.bookE4"),
        ("d2d4", 6, "morphy.bookD4"),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 82, "morphy.bookEvans"),
        ("c2c3", 12, "morphy.bookC3"),
        ("e1g1", 6, "morphy.bookCastle"),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": [
        ("d2d4", 100, "morphy.bookOpera"),
    ],
}

MORPHY_OPENING_BOOK = load_bot_opening_book("morphy", DEFAULT_MORPHY_BOOK)


MORPHY_STYLE = Style(
    "morphy",
    Rule(CASTLING, 45.0, "morphy.castle"),
    Group(
        piece(*MINOR_PIECES) & by_move(14),
        Rule(
            FROM_BACK_RANK, 32.0,
            "morphy.develop",
        ),
        Rule(to(EXTENDED_CENTER), 18.0, "morphy.centralize", Note.FILL),
    ),
    Rule(piece(chess.ROOK) & to_file(3, 4), 26.0, "morphy.rookFile"),
    Rule(to(CENTER_SQUARES), 24.0, "morphy.openCenter", Note.FILL),
    FirstOf(
        Rule(CHECK, 28.0, "morphy.check"),
        Rule(CAPTURE, 16.0, "morphy.capture", Note.FILL),
    ),
)
evaluate_morphy_style_bonus = MORPHY_STYLE.evaluate


class MorphyBot(HistoricalBot):
    """Пол Морфи (~1850 UCI Эло, depth=6, skill=8)."""

    bot_id = "morphy"
    engine_source_name = "morphy_style_engine"
    default_comment = "morphy.default"
    blunder_guard_cp = MORPHY_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 8
    opening_book = MORPHY_OPENING_BOOK
    style = MORPHY_STYLE
    default_skill_level = 8
    default_uci_elo = 1850


morphy_bot = MorphyBot()
