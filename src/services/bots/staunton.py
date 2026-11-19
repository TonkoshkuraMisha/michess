# --- FILE: src/services/bots/staunton.py ---
"""
Исторический бот «Говард Стаунтон»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/staunton.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_STAUNTON_BOOK).

Стиль (STAUNTON_STYLE) — бонусы в сантипешках кандидатам движка: фланговый контроль центра пешкой «c», развитие и
рокировка, после дебюта — профилактика и сохранение пешечной структуры. Бонусы только выбирают среди ходов, близких
по оценке к лучшему (окно — blunder_guard_cp); оценку позиции они не меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 2000; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.staunton.* на клиенте.
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
    FROM_BACK_RANK,
    MINOR_PIECES,
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
STAUNTON_BLUNDER_GUARD_CP = 110.0

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
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
    Group(
        after_move(12),
        Rule(QUIET, prophylaxis),
        Rule(ALWAYS, pawn_structure_delta),
    ),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_staunton_style_bonus = STAUNTON_STYLE.evaluate


class StauntonBot(HistoricalBot):
    """Говард Стаунтон: UCI_Elo 2000, глубина 6, уровень 7; случайный разброс ±6 сп, MultiPV 6."""

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
