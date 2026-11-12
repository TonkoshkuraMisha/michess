# --- FILE: src/services/bots/labourdonnais.py ---


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

LABOURDONNAIS_BLUNDER_GUARD_CP = 200.0

DEFAULT_LABOURDONNAIS_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 81, "Любимый ход Лабурдонне в атаке: открываем линии для фигур!"),
        ("d2d4", 16, "Ферзевый гамбит в стиле матчей с Мак-Доннеллом."),
        ("f2f4", 3, "Дебют Берда — фланговый зажим центра."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -": [
        ("b2b4", 86, "Гамбит Эванса! Жертвуем пешку ради стремительного захвата центра!"),
        ("c2c3", 14, "Тихая итальянская партия с подготовкой d2-d4."),
    ],
}

LABOURDONNAIS_OPENING_BOOK = load_bot_opening_book("labourdonnais", DEFAULT_LABOURDONNAIS_BOOK)


LABOURDONNAIS_STYLE = Style(
    "labourdonnais",
    Rule(CASTLING, 38.0, "Рокировка! Вводим ладью в бой и готовим решительный штурм."),
    Group(
        piece(*MINOR_PIECES) & by_move(12),
        Rule(FROM_BACK_RANK, 25.0, "Быстро выводим фигуры в бой — каждый темп на счету!"),
        Rule(to(EXTENDED_CENTER), 18.0, "Фигуры устремляются в центр для комбинационной атаки!"),
    ),
    Rule(
        to(CENTER_SQUARES), 22.0,
        "Захватываем инициативу в центре в духе французской романтической школы!", Note.FILL,
    ),
    FirstOf(
        Rule(CHECK, 24.0, "Шах! Не даём сопернику передышки!"),
        Rule(CAPTURE, 14.0),
    ),
)
evaluate_labourdonnais_style_bonus = LABOURDONNAIS_STYLE.evaluate


class LabourdonnaisBot(HistoricalBot):
    """Луи-Шарль Маэ де Лабурдонне (~1650 UCI Эло, depth=5, skill=5)."""

    bot_id = "labourdonnais"
    engine_source_name = "labourdonnais_style_engine"
    default_comment = "Атака и комбинационный натиск в стиле «Кафе де ля Режанс»!"
    blunder_guard_cp = LABOURDONNAIS_BLUNDER_GUARD_CP
    jitter_range = 12.0
    multipv = 8
    opening_book = LABOURDONNAIS_OPENING_BOOK
    style = LABOURDONNAIS_STYLE
    default_skill_level = 5
    default_uci_elo = 1650
    default_search_depth = 5


labourdonnais_bot = LabourdonnaisBot()
