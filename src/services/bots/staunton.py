# --- FILE: src/services/bots/staunton.py ---

import chess

from src.services.bots.base import HistoricalBot, load_bot_opening_book
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


STAUNTON_STYLE = Style(
    "staunton",
    Rule(
        CASTLING, 40.0,
        "Рокировка в духе английской классической школы: король в безопасности, ладья входит в игру.",
    ),
    Group(
        piece(chess.PAWN) & by_move(12),
        FirstOf(
            Rule(to({chess.C4, chess.C5}), 30.0, "Берём под фланговый контроль центральный пункт по системе Стаунтона!"),
            Rule(to(CENTER_SQUARES), 24.0, "Укрепляем позиции в центре доски."),
        ),
    ),
    Group(
        piece(*MINOR_PIECES) & by_move(12),
        Rule(FROM_BACK_RANK, 26.0, "Развиваем фигуры на стратегически важные поля.", Note.FILL),
        Rule(to(EXTENDED_CENTER), 16.0),
    ),
    FirstOf(
        Rule(CHECK, 18.0, "Тактический шах для перехвата инициативы.", Note.FILL),
        Rule(CAPTURE, 14.0),
    ),
)
evaluate_staunton_style_bonus = STAUNTON_STYLE.evaluate


class StauntonBot(HistoricalBot):
    """Говард Стаунтон (~1750 UCI Эло, depth=6, skill=7)."""

    bot_id = "staunton"
    engine_source_name = "staunton_style_engine"
    default_comment = "Фундаментальная позиционная игра по канонам «The Chess-Player's Handbook»."
    blunder_guard_cp = STAUNTON_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = STAUNTON_OPENING_BOOK
    style = STAUNTON_STYLE
    default_skill_level = 7
    default_uci_elo = 1750


staunton_bot = StauntonBot()
