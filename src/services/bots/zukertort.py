# --- FILE: src/services/bots/zukertort.py ---
"""
Исторический бот «Иоганн Цукерторт»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/zukertort.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_ZUKERTORT_BOOK).

Стиль (ZUKERTORT_STYLE) — бонусы в сантипешках кандидатам движка: развитие и рокировка, центр, шахи, после дебюта —
умеренное давление на короля соперника. Бонусы только выбирают среди ходов, близких по оценке к лучшему (окно —
blunder_guard_cp); оценку позиции они не меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 2120; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.zukertort.* на клиенте.
"""

from src.services.bots.base import BookEntry, HistoricalBot, load_bot_opening_book
from src.services.bots.style import (
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    FROM_BACK_RANK,
    MINOR_PIECES,
    NEAR_ENEMY_KING,
    SACRIFICE,
    FirstOf,
    Group,
    Note,
    Rule,
    Style,
    after_move,
    by_move,
    piece,
    to,
)

# Ширина окна выбора хода, сп (base.HistoricalBot._window): с опорным ходом силы бот может уступить ему не больше
# половины этого значения, без движка — лучшему ходу не больше всего значения. Чем шире, тем больше простора стилю.
ZUKERTORT_BLUNDER_GUARD_CP = 140.0

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
DEFAULT_ZUKERTORT_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 72, "zukertort.bookE4"),
        ("g1f3", 16, "zukertort.bookNf3"),
        ("d2d4", 12, "zukertort.bookD4"),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 75, "zukertort.bookE5"),
        ("c7c5", 15, "zukertort.bookSicilian"),
        ("e7e6", 10, "zukertort.bookFrench"),
    ],
}

ZUKERTORT_OPENING_BOOK = load_bot_opening_book("zukertort", DEFAULT_ZUKERTORT_BOOK)


ZUKERTORT_STYLE = Style(
    "zukertort",
    Rule(CASTLING, 40.0, "zukertort.castle"),
    Group(
        piece(*MINOR_PIECES) & by_move(14),
        Rule(FROM_BACK_RANK, 28.0, "zukertort.develop"),
        Rule(to(EXTENDED_CENTER), 18.0),
    ),
    Rule(to(CENTER_SQUARES), 22.0, "zukertort.center", Note.FILL),
    FirstOf(
        Rule(
            CHECK, 26.0,
            "zukertort.check",
        ),
        Rule(CAPTURE, 16.0),
    ),
    Group(
        after_move(14),
        Rule(NEAR_ENEMY_KING, 14.0),
        Rule(SACRIFICE, 12.0),
    ),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_zukertort_style_bonus = ZUKERTORT_STYLE.evaluate


class ZukertortBot(HistoricalBot):
    """Иоганн Цукерторт: UCI_Elo 2120, глубина 6, уровень 8; случайный разброс ±8 сп, MultiPV 8."""

    bot_id = "zukertort"
    engine_source_name = "zukertort_style_engine"
    default_comment = "zukertort.default"
    blunder_guard_cp = ZUKERTORT_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 8
    opening_book = ZUKERTORT_OPENING_BOOK
    style = ZUKERTORT_STYLE
    default_uci_elo = 2120


zukertort_bot = ZukertortBot()
