# --- FILE: src/services/bots/labourdonnais.py ---
"""
Исторический бот «Луи-Шарль де Лабурдонне»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/labourdonnais.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_LABOURDONNAIS_BOOK).

Стиль (LABOURDONNAIS_STYLE) — бонусы в сантипешках кандидатам движка: быстрое развитие лёгких фигур и рокировка,
центр, шахи и взятия, после дебюта — фигуры к королю соперника и жертвы. Бонусы только выбирают среди ходов, близких
по оценке к лучшему (окно — blunder_guard_cp); оценку позиции они не меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 1950; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.labourdonnais.* на клиенте.
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
LABOURDONNAIS_BLUNDER_GUARD_CP = 200.0

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
DEFAULT_LABOURDONNAIS_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 81, "labourdonnais.bookE4"),
        ("d2d4", 16, "labourdonnais.bookD4"),
        ("f2f4", 3, "labourdonnais.bookF4"),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 86, "labourdonnais.bookEvans"),
        ("c2c3", 14, "labourdonnais.bookC3"),
    ],
}

LABOURDONNAIS_OPENING_BOOK = load_bot_opening_book("labourdonnais", DEFAULT_LABOURDONNAIS_BOOK)


LABOURDONNAIS_STYLE = Style(
    "labourdonnais",
    Rule(CASTLING, 38.0, "labourdonnais.castle"),
    Group(
        piece(*MINOR_PIECES) & by_move(12),
        Rule(FROM_BACK_RANK, 25.0, "labourdonnais.develop"),
        Rule(to(EXTENDED_CENTER), 18.0, "labourdonnais.centralize"),
    ),
    Rule(
        to(CENTER_SQUARES), 22.0,
        "labourdonnais.center", Note.FILL,
    ),
    FirstOf(
        Rule(CHECK, 24.0, "labourdonnais.check"),
        Rule(CAPTURE, 14.0),
    ),
    Group(
        after_move(12),
        Rule(NEAR_ENEMY_KING, 20.0),
        Rule(SACRIFICE, 16.0),
    ),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_labourdonnais_style_bonus = LABOURDONNAIS_STYLE.evaluate


class LabourdonnaisBot(HistoricalBot):
    """Луи-Шарль Маэ де Лабурдонне: UCI_Elo 1950, глубина 5, уровень 5; случайный разброс ±12 сп, MultiPV 8."""

    bot_id = "labourdonnais"
    engine_source_name = "labourdonnais_style_engine"
    default_comment = "labourdonnais.default"
    blunder_guard_cp = LABOURDONNAIS_BLUNDER_GUARD_CP
    jitter_range = 12.0
    multipv = 8
    opening_book = LABOURDONNAIS_OPENING_BOOK
    style = LABOURDONNAIS_STYLE
    default_skill_level = 5
    default_uci_elo = 1950
    default_search_depth = 5


labourdonnais_bot = LabourdonnaisBot()
