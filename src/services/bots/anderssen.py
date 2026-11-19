# --- FILE: src/services/bots/anderssen.py ---
"""
Исторический бот «Адольф Андерсен»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/anderssen.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_ANDERSSEN_BOOK).

Стиль (ANDERSSEN_STYLE) — бонусы в сантипешках кандидатам движка: шахи, взятия ради открытия линий, развитие, после
дебюта — жертвы и фигуры у короля соперника (окно выбора хода у него самое широкое из семи ботов). Бонусы только
выбирают среди ходов, близких по оценке к лучшему (окно — blunder_guard_cp); оценку позиции они не меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 2100; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.anderssen.* на клиенте.
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
ANDERSSEN_BLUNDER_GUARD_CP = 220.0

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
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
    Group(
        after_move(14),
        Rule(SACRIFICE, 30.0, "anderssen.openLines", Note.FILL),
        Rule(NEAR_ENEMY_KING, 18.0),
    ),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_anderssen_style_bonus = ANDERSSEN_STYLE.evaluate


class AnderssenBot(HistoricalBot):
    """Адольф Андерсен: UCI_Elo 2100, глубина 6, уровень 8; случайный разброс ±10 сп, MultiPV 8."""

    bot_id = "anderssen"
    engine_source_name = "anderssen_style_engine"
    default_comment = "anderssen.default"
    blunder_guard_cp = ANDERSSEN_BLUNDER_GUARD_CP
    jitter_range = 10.0
    multipv = 8
    opening_book = ANDERSSEN_OPENING_BOOK
    style = ANDERSSEN_STYLE
    default_skill_level = 8
    default_uci_elo = 2100


anderssen_bot = AnderssenBot()
