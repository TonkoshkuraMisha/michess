# --- FILE: src/services/bots/zukertort.py ---


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

ZUKERTORT_BLUNDER_GUARD_CP = 140.0

DEFAULT_ZUKERTORT_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 72, "Открытая игра с последующим комбинационным штурмом."),
        ("g1f3", 16, "Дебют Цукерторта (1. Nf3!) — гибкое развитие с сохранением выбора плана в центре!"),
        ("d2d4", 12, "Закрытое начало с переходом в систему Цукерторта (d4, Nf3, e3, Bd3, b3)."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 75, "Классический открытый бой 1...e5."),
        ("c7c5", 15, "Сицилианская защита."),
        ("e7e6", 10, "Французская защита."),
    ],
}

ZUKERTORT_OPENING_BOOK = load_bot_opening_book("zukertort", DEFAULT_ZUKERTORT_BOOK)


ZUKERTORT_STYLE = Style(
    "zukertort",
    Rule(CASTLING, 40.0, "Рокировка! Завершаем развитие и готовим тактический прорыв."),
    Group(
        piece(*MINOR_PIECES) & by_move(14),
        Rule(FROM_BACK_RANK, 28.0, "Гибкое развитие фигур по системе Цукерторта."),
        Rule(to(EXTENDED_CENTER), 18.0),
    ),
    Rule(to(CENTER_SQUARES), 22.0, "Энергичный захват ключевых центральных полей!", Note.FILL),
    FirstOf(
        Rule(
            CHECK, 26.0,
            "Шах! Переходим к решительной комбинационной атаке в стиле Лондонского турнира 1883 года!",
        ),
        Rule(CAPTURE, 16.0),
    ),
)
evaluate_zukertort_style_bonus = ZUKERTORT_STYLE.evaluate


class ZukertortBot(HistoricalBot):
    """Иоганн Цукерторт (~1840 UCI Эло, depth=6, skill=8)."""

    bot_id = "zukertort"
    engine_source_name = "zukertort_style_engine"
    default_comment = "Тонкий стратегический манёвр с подготовкой комбинационного взрыва в стиле Цукерторта!"
    blunder_guard_cp = ZUKERTORT_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 8
    opening_book = ZUKERTORT_OPENING_BOOK
    style = ZUKERTORT_STYLE
    default_skill_level = 8
    default_uci_elo = 1840


zukertort_bot = ZukertortBot()
