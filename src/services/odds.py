"""
Фора в партии с человеком (таск 21.1, сеть — 16.11): те же форы, что у партии с ботом
(frontend/src/components/chessboard/odds.ts).
Материальная — начальная позиция без фигуры у дающего фору (ферзевый конь, ферзевая ладья — без длинной рокировки,
ферзь, f-пешка); по времени — у дающего треть времени (не меньше минуты); «песочные часы» — время, потраченное
ходящим, прибавляется сопернику (общая для обоих фора, дающего нет; часы считает src/services/game_state.py по флагу
games.hourglass). Партия с форой рейтинга не меняет.

Фора задаётся в приглашении по ссылке; применяет её src/services/matchmaker.py (``_odds_start``) в момент старта,
когда цвета уже известны, — он же делает партию товарищеской. Здесь только расчёт позиции и времени.
"""

import chess

# Вид материальной форы → поле снимаемой фигуры, если фору дают белые и если чёрные.
MATERIAL = {"knight": ("b1", "b8"), "rook": ("a1", "a8"), "queen": ("d1", "d8"), "pawn": ("f2", "f7")}
HOURGLASS = "hourglass"  # «песочные часы»: позиция и стартовое время обычные, меняется только ход часов
KINDS = (*MATERIAL, "time", HOURGLASS)  # все виды форы; пустая строка в приглашении — партия без форы
GIVERS = ("creator", "acceptor")  # кто даёт фору: автор приглашения или тот, кто его принял


def odds_fen(kind: str, giver: chess.Color) -> str | None:
    """Начальная позиция с материальной форой; None — фора не материальная."""
    squares = MATERIAL.get(kind)
    if squares is None:
        return None
    board = chess.Board()
    board.remove_piece_at(chess.parse_square(squares[0 if giver == chess.WHITE else 1]))
    if kind == "rook":
        board.castling_rights &= ~(chess.BB_A1 if giver == chess.WHITE else chess.BB_A8)
    return board.fen()


def odds_times(kind: str, giver: chess.Color, base_ms: int) -> tuple[int, int]:
    """
    Стартовое время белых и чёрных. Фора по времени: у дающего — треть базового времени, но не меньше минуты;
    у соперника — полное. Нижняя граница не сравнивается с базовым временем: при контроле короче минуты дающий
    получил бы больше соперника.
    """
    if kind != "time":
        return base_ms, base_ms
    cut = max(60_000, round(base_ms / 3))
    return (cut, base_ms) if giver == chess.WHITE else (base_ms, cut)


def pgn_header(start_fen: str) -> str:
    """
    Начало PGN партии с позиции: заголовки SetUp/FEN — их понимают проверка ходов на сервере и клиент. Партия Фишера
    (позиция в Shredder-FEN, game_engine.is_chess960_fen) получает и заголовок Variant.
    """
    from src.services.game_engine import CHESS960_HEADER, is_chess960_fen

    variant = f"{CHESS960_HEADER}\n" if is_chess960_fen(start_fen) else ""
    return f'{variant}[SetUp "1"]\n[FEN "{start_fen}"]'
