# --- FILE: src/services/bots/paulsen.py ---
"""
Исторический бот «Луи Паульсен»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/paulsen.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_PAULSEN_BOOK).

Стиль (PAULSEN_STYLE) — бонусы в сантипешках кандидатам движка: гибкая пешечная структура без раннего занятия
центра, слоны на длинные диагонали, профилактика и сохранение структуры. Бонусы только выбирают среди ходов, близких
по оценке к лучшему (окно — blunder_guard_cp); оценку позиции они не меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 2080; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.paulsen.* на клиенте.
"""

import chess

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.style import (
    ALWAYS,
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    QUIET,
    FirstOf,
    Group,
    Note,
    Rule,
    Style,
    after_move,
    by_move,
    pawn_structure_delta,
    piece,
    prophylaxis,
    to,
)

# Ширина окна выбора хода, сп (base.HistoricalBot._window): с опорным ходом силы бот может уступить ему не больше
# половины этого значения, без движка — лучшему ходу не больше всего значения. Чем шире, тем больше простора стилю.
PAULSEN_BLUNDER_GUARD_CP = 110.0

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
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
    Group(
        after_move(14),
        Rule(QUIET, prophylaxis),
        Rule(ALWAYS, pawn_structure_delta),
    ),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_paulsen_style_bonus = PAULSEN_STYLE.evaluate


class PaulsenBot(HistoricalBot):
    """Луи Паульсен: UCI_Elo 2080, глубина 6, уровень 8; случайный разброс ±6 сп, MultiPV 6."""

    bot_id = "paulsen"
    engine_source_name = "paulsen_style_engine"
    default_comment = "paulsen.default"
    blunder_guard_cp = PAULSEN_BLUNDER_GUARD_CP
    jitter_range = 6.0
    multipv = 6
    opening_book = PAULSEN_OPENING_BOOK
    style = PAULSEN_STYLE
    default_uci_elo = 2080


paulsen_bot = PaulsenBot()
