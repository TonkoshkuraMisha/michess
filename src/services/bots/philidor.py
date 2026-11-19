# --- FILE: src/services/bots/philidor.py ---
"""
Исторический бот «Франсуа-Андре Филидор»: дебютная книга и правила стиля.

Дебют — книга из партий прототипа (books/philidor.json, собирает scripts/build_opening_books.py) и несколько
«фирменных» начал, заданных здесь (DEFAULT_PHILIDOR_BOOK).

Стиль (PHILIDOR_STYLE) — бонусы в сантипешках кандидатам движка: ходы пешками в центр и за пространством («пешки —
душа шахмат»), конь не встаёт перед своей пешкой «c» или «f», пока она не пошла, сохранение пешечной структуры.
Бонусы только выбирают среди ходов, близких по оценке к лучшему (окно — blunder_guard_cp); оценку позиции они не
меняют.

Сила: заявленный рейтинг и ограничение движка UCI_Elo — 1850; измеренная матчами — calibration.json. Порядок выбора
хода — base.HistoricalBot; реплики бота — ключи каталога botComments.philidor.* на клиенте.
"""

import chess

from src.services.bots.base import (
    PIECE_VALUES,
    BookEntry,
    HistoricalBot,
    _simulate_human_thinking_time,
    analyse_with_stockfish,
    load_bot_opening_book,
    normalize_fen_key,
    resolve_stockfish_path,
    static_board_eval_cp,
)
from src.services.bots.style import (
    ALWAYS,
    CENTER_SQUARES,
    EXTENDED_CENTER,
    FirstOf,
    Group,
    Rule,
    Style,
    by_move,
    pawn_structure_delta,
    piece,
    piece_on,
    side,
    to,
)

# Ширина окна выбора хода, сп (base.HistoricalBot._window): с опорным ходом силы бот может уступить ему не больше
# половины этого значения, без движка — лучшему ходу не больше всего значения. Чем шире, тем больше простора стилю.
PHILIDOR_BLUNDER_GUARD_CP = 120.0
# Прежнее имя константы; в коде проекта не используется.
BLUNDER_GUARD_MARGIN_CP = PHILIDOR_BLUNDER_GUARD_CP

# Фирменные линии: позиция (FEN без счётчиков ходов) → [(UCI, вес, ключ реплики botComments.*)]. Поверх книги из
# books/*.json (load_bot_opening_book): ход из файла заменяет совпадающий, а фирменные ходы, которых в файле нет,
# добавляются.
DEFAULT_PHILIDOR_BOOK: dict[str, list[BookEntry]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 92, "philidor.bookE4"),
        ("d2d4", 8, "philidor.bookD4"),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 72, "philidor.bookE5"),
        ("c7c5", 18, "philidor.bookC5"),
        ("e7e6", 10, "philidor.bookE6"),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("d7d6", 100, "philidor.bookDefense"),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq -": [
        ("f7f5", 65, "philidor.bookF5"),
        ("e5d4", 35, "philidor.bookExd4"),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "philidor.bookC3"),
    ],
}

PHILIDOR_OPENING_BOOK = load_bot_opening_book("philidor", DEFAULT_PHILIDOR_BOOK)
# Принудительно: на 1.e4 e5 2.Nf3 бот всегда отвечает d6 (защита его имени), даже если в книге из партий архива
# есть другие ответы.
PHILIDOR_OPENING_BOOK["rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -"] = [
    ("d7d6", 100, "philidor.bookDefense"),
]


# Пешки для условия piece_on в правилах «конь не перед пешкой c/f» (поля c2/f2 и c7/f7).
WHITE_PAWN = chess.Piece(chess.PAWN, chess.WHITE)
BLACK_PAWN = chess.Piece(chess.PAWN, chess.BLACK)

PHILIDOR_STYLE = Style(
    "philidor",
    Group(
        piece(chess.PAWN),
        Rule(ALWAYS, 14.0),
        FirstOf(
            Rule(to(CENTER_SQUARES), 35.0, "philidor.pawnCenter"),
            Rule(to(EXTENDED_CENTER), 22.0, "philidor.pawnSpace"),
            Rule(
                to({chess.C3, chess.C6, chess.D3, chess.D6}), 16.0,
                "philidor.pawnPrepare",
            ),
        ),
    ),
    # «Конь не должен становиться впереди пешки c»: штраф за Nc3/Nf3 (Nc6/Nf6), пока пешка не пошла.
    Group(
        piece(chess.KNIGHT) & by_move(10) & side(chess.WHITE),
        Rule(to({chess.C3}) & piece_on(chess.C2, WHITE_PAWN), -55.0),
        Rule(to({chess.F3}) & piece_on(chess.F2, WHITE_PAWN), -45.0),
    ),
    Group(
        piece(chess.KNIGHT) & by_move(10) & side(chess.BLACK),
        Rule(to({chess.C6}) & piece_on(chess.C7, BLACK_PAWN), -55.0),
        Rule(to({chess.F6}) & piece_on(chess.F7, BLACK_PAWN), -45.0),
    ),
    Rule(ALWAYS, pawn_structure_delta),
)
# Функция оценки стиля как самостоятельное имя (её импортируют тесты бота).
evaluate_philidor_style_bonus = PHILIDOR_STYLE.evaluate


class PhilidorBot(HistoricalBot):
    """Франсуа-Андре Филидор: UCI_Elo 1850, глубина 6, уровень 7 (значения базового класса); разброс ±8 сп, MultiPV 6."""

    bot_id = "philidor"
    engine_source_name = "philidor_style_engine_deep"
    default_comment = "philidor.default"
    blunder_guard_cp = PHILIDOR_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 6
    opening_book = PHILIDOR_OPENING_BOOK
    style = PHILIDOR_STYLE


philidor_bot = PhilidorBot()

# Реэкспорт общих функций base: старые импорты тестов и src/api/bots.py идут через этот модуль.
__all__ = [
    "CENTER_SQUARES",
    "EXTENDED_CENTER",
    "PIECE_VALUES",
    "PHILIDOR_OPENING_BOOK",
    "PhilidorBot",
    "philidor_bot",
    "evaluate_philidor_style_bonus",
    "analyse_with_stockfish",
    "normalize_fen_key",
    "resolve_stockfish_path",
    "static_board_eval_cp",
    "_simulate_human_thinking_time",
]
