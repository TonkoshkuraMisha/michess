# --- FILE: src/services/bots/philidor.py ---

import chess

from src.services.bots.base import (
    CENTER_SQUARES,
    EXTENDED_CENTER,
    PIECE_VALUES,
    HistoricalBot,
    _simulate_human_thinking_time,
    analyse_with_stockfish,
    load_bot_opening_book,
    normalize_fen_key,
    resolve_stockfish_path,
    static_board_eval_cp,
)

PHILIDOR_BLUNDER_GUARD_CP = 120.0
BLUNDER_GUARD_MARGIN_CP = PHILIDOR_BLUNDER_GUARD_CP

DEFAULT_PHILIDOR_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 92, "Пешка короля открывает путь слону и занимает центр (11 партий)."),
        ("d2d4", 8, "Атака ферзевой пешкой с последующим c2-c4."),
    ],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 72, "Встретим пешку соперника в центре: e7-e5 (8 партий)."),
        ("c7c5", 18, "Асимметричный фланговый ответ c7-c5 (3 партии)."),
        ("e7e6", 10, "Сдержанное построение e7-e6, готовя удар d7-d5."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq -": [
        ("f7f5", 65, "Контрудар f7-f5! Как я писал в «Анализе шахматной игры», перехватим инициативу пешками."),
        ("e5d4", 35, "Разменяем центральную пешку, удерживая прочный редут на d6."),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Сначала c2-c3! Конь никогда не должен становиться впереди пешки c."),
    ],
}

PHILIDOR_OPENING_BOOK = load_bot_opening_book("philidor", DEFAULT_PHILIDOR_BOOK)
# Гарантируем, что классическая защита Филидора 1.e4 e5 2.Nf3 d6 всегда имеет приоритет
PHILIDOR_OPENING_BOOK["rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -"] = [
    ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
]


def _evaluate_pawn_structure(board: chess.Board, us: chess.Color) -> float:
    our_pawns = board.pieces(chess.PAWN, us)
    start_rank = 1 if us == chess.WHITE else 6
    pawn_files = [chess.square_file(sq) for sq in our_pawns]

    score = 0.0
    for sq in our_pawns:
        f = chess.square_file(sq)
        r = chess.square_rank(sq)
        if r != start_rank:
            score += float(r if us == chess.WHITE else (7 - r)) * 3.0
        if f < 7 and chess.square(f + 1, r) in our_pawns:
            score += 15.0
        support_rank = (r - 1) if us == chess.WHITE else (r + 1)
        # Диапазон проверяется первым: для крайних горизонталей support_rank выходит за доску.
        if 0 <= support_rank <= 7 and (
                (f > 0 and chess.square(f - 1, support_rank) in our_pawns)
                or (f < 7 and chess.square(f + 1, support_rank) in our_pawns)
        ):
            score += 10.0

    doubled_pawns = len(pawn_files) - len(set(pawn_files))
    score -= float(doubled_pawns) * 20.0
    return score


def evaluate_philidor_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    us = board_before.turn
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if piece.piece_type == chess.PAWN:
        bonus += 14.0
        if move.to_square in CENTER_SQUARES:
            bonus += 35.0
            note = "Пешки — душа шахмат! Мощный удар в центр доски."
        elif move.to_square in EXTENDED_CENTER:
            bonus += 22.0
            note = "Занимаем пространство пешечной фалангой."
        elif move.to_square in {chess.C3, chess.C6, chess.D3, chess.D6}:
            bonus += 16.0
            note = "Подготавливаем продвижение центральной пешки по методу Филидора."

    if piece.piece_type == chess.KNIGHT and board_before.fullmove_number <= 10:
        if us == chess.WHITE:
            if move.to_square == chess.C3 and board_before.piece_at(chess.C2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 55.0
            if move.to_square == chess.F3 and board_before.piece_at(chess.F2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 45.0
        else:
            if move.to_square == chess.C6 and board_before.piece_at(chess.C7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 55.0
            if move.to_square == chess.F6 and board_before.piece_at(chess.F7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 45.0

    structure_before = _evaluate_pawn_structure(board_before, us)
    board_after = board_before.copy()
    board_after.push(move)
    structure_after = _evaluate_pawn_structure(board_after, us)
    bonus += structure_after - structure_before

    return bonus, note


class PhilidorBot(HistoricalBot):
    """Франсуа-Андре Филидор (~1850 Эло, depth=6, skill=7)."""

    bot_id = "philidor"
    engine_source_name = "philidor_style_engine_deep"
    default_comment = "Пешки — душа шахмат. Строим несокрушимую пешечную цепь."
    blunder_guard_cp = PHILIDOR_BLUNDER_GUARD_CP
    jitter_range = 8.0
    multipv = 6
    opening_book = PHILIDOR_OPENING_BOOK

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 7,
            uci_elo: int = 1850,
            search_depth: int = 6,
    ):
        super().__init__(stockfish_path, skill_level, uci_elo, search_depth)

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return evaluate_philidor_style_bonus(board_before, move)


philidor_bot = PhilidorBot()

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
