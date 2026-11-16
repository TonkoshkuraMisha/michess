"""
Фора в партии с человеком (таск 21.1, сеть — 16.11): те же форы, что у партии с ботом (frontend/.../odds.ts).
Материальная — начальная позиция без фигуры у дающего фору (ферзевый конь, ферзевая ладья — без длинной рокировки,
ферзь, f-пешка); по времени — у дающего треть времени (не меньше минуты). Партия с форой рейтинга не меняет.
"""

import chess

MATERIAL = {"knight": ("b1", "b8"), "rook": ("a1", "a8"), "queen": ("d1", "d8"), "pawn": ("f2", "f7")}
KINDS = (*MATERIAL, "time")
GIVERS = ("creator", "acceptor")


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
    """Стартовое время белых и чёрных."""
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
