# --- FILE: src/services/bots/anderssen.py ---


from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.style import (
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    FROM_BACK_RANK,
    MINOR_PIECES,
    Group,
    Note,
    Rule,
    Style,
    by_move,
    piece,
    to,
)

ANDERSSEN_BLUNDER_GUARD_CP = 220.0

DEFAULT_ANDERSSEN_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 96, "anderssen.bookGambit"),
        ("a2a3", 2, "anderssen.bookA3"),
        ("d2d4", 1, "anderssen.bookD4"),
        ("f2f4", 1, "anderssen.bookF4"),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 97, "anderssen.bookEvans"),
        ("e1g1", 2, "anderssen.bookCastle"),
        ("c2c3", 1, "anderssen.bookItalian"),
    ],
}

ANDERSSEN_OPENING_BOOK = load_bot_opening_book("anderssen", DEFAULT_ANDERSSEN_BOOK)


ANDERSSEN_STYLE = Style(
    "anderssen",
    Rule(CHECK, 36.0, "anderssen.check"),
    Rule(CAPTURE, 24.0, "anderssen.openLines", Note.FILL),
    Rule(CASTLING, 38.0, "anderssen.castle"),
    Group(
        piece(*MINOR_PIECES) & by_move(14),
        Rule(FROM_BACK_RANK, 28.0, "anderssen.develop", Note.FILL),
        Rule(to(EXTENDED_CENTER), 18.0),
    ),
    Rule(to(CENTER_SQUARES), 22.0, "anderssen.center", Note.FILL),
)
evaluate_anderssen_style_bonus = ANDERSSEN_STYLE.evaluate


class AnderssenBot(HistoricalBot):
    """Адольф Андерсен (~1820 UCI Эло, depth=6, skill=8)."""

    bot_id = "anderssen"
    engine_source_name = "anderssen_style_engine"
    default_comment = "anderssen.default"
    blunder_guard_cp = ANDERSSEN_BLUNDER_GUARD_CP
    jitter_range = 10.0
    multipv = 8
    opening_book = ANDERSSEN_OPENING_BOOK
    style = ANDERSSEN_STYLE
    default_skill_level = 8
    default_uci_elo = 1820


anderssen_bot = AnderssenBot()
