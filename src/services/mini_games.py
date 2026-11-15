# --- FILE: src/services/mini_games.py ---
"""
Игры тренеров (таск 19.8) — учебные игры с упрощёнными правилами поверх python-chess (обычный движок их не знает).

* pawn_war — «Пешечный бой»: только пешки; побеждает первый, кто провёл пешку или съел все пешки соперника.
* king_pawns — «Король и пешки»: короли и по восемь пешек; побеждает первый, кто провёл пешку (или поставил мат).
* queen_vs_pawns — «Ферзь против восьми пешек»: белый ферзь съедает все пешки — победа белых; пешка дошла — чёрных.
* rook_vs_pawns — «Ладья против пешек»: белая ладья против четырёх пешек, те же условия.
* capture_flag — «Захват флага»: короли и пешки; побеждает первый, кто довёл короля до последней горизонтали соперника.

Если у стороны, которая ходит, нет ходов — ничья (в играх с королями: под шахом — поражение). Превращение — сразу
конец игры (в ферзя). Без королей проверки шаха нет — ходы псевдолегальные. Бот — перебор с альфа-бета-отсечением и
простой оценкой (материал, продвижение пешек, путь короля к флагу): для этих игр этого достаточно.
"""

from dataclasses import dataclass

import chess

from src.core.errors import DomainError


@dataclass(frozen=True)
class MiniGame:
    id: str
    fen: str
    kings: bool


GAMES: dict[str, MiniGame] = {
    "pawn_war": MiniGame("pawn_war", "8/pppppppp/8/8/8/8/PPPPPPPP/8 w - - 0 1", kings=False),
    "king_pawns": MiniGame("king_pawns", "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1", kings=True),
    "queen_vs_pawns": MiniGame("queen_vs_pawns", "8/pppppppp/8/8/8/8/8/3Q4 w - - 0 1", kings=False),
    "rook_vs_pawns": MiniGame("rook_vs_pawns", "8/pppp4/8/8/8/8/8/7R w - - 0 1", kings=False),
    "capture_flag": MiniGame("capture_flag", "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1", kings=True),
}

WIN = 100_000
PIECE_VALUE = {chess.PAWN: 100, chess.KNIGHT: 300, chess.BISHOP: 300, chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0}


def get_game(game_id: str) -> MiniGame:
    game = GAMES.get(game_id)
    if game is None:
        raise DomainError("mini_game_not_found")
    return game


def board_of(game: MiniGame, fen: str) -> chess.Board:
    try:
        board = chess.Board(fen)
    except ValueError:
        raise DomainError("mini_game_bad_position") from None
    if game.kings and (board.king(chess.WHITE) is None or board.king(chess.BLACK) is None):
        raise DomainError("mini_game_bad_position")
    return board


def moves(game: MiniGame, board: chess.Board) -> list[chess.Move]:
    """Ходы по правилам игры: с королями — легальные, без — псевдолегальные; превращение — только в ферзя."""
    source = board.legal_moves if game.kings else board.pseudo_legal_moves
    return [m for m in source if m.promotion in (None, chess.QUEEN)]


def result(game: MiniGame, board: chess.Board) -> str | None:
    """Итог: '1-0', '0-1', '1/2-1/2' или None (игра продолжается). Проверяется после каждого хода."""
    last_rank = {chess.WHITE: 7, chess.BLACK: 0}
    # Пешка дошла (превратилась) — победа её стороны.
    # Ферзей в начале игр нет (кроме белого в «Ферзь против пешек»), значит, ферзь на последней горизонтали — превращение.
    for color in (chess.WHITE, chess.BLACK):
        if game.id == "queen_vs_pawns" and color == chess.WHITE:
            continue
        if any(chess.square_rank(sq) == last_rank[color] for sq in board.pieces(chess.QUEEN, color)):
            return "1-0" if color == chess.WHITE else "0-1"
    if game.id == "capture_flag":
        for color in (chess.WHITE, chess.BLACK):
            king = board.king(color)
            if king is not None and chess.square_rank(king) == last_rank[color]:
                return "1-0" if color == chess.WHITE else "0-1"
    # Съедены все пешки соперника.
    if game.id == "pawn_war":
        if not board.pieces(chess.PAWN, chess.BLACK):
            return "1-0"
        if not board.pieces(chess.PAWN, chess.WHITE):
            return "0-1"
    if game.id in ("queen_vs_pawns", "rook_vs_pawns"):
        if not board.pieces(chess.PAWN, chess.BLACK):
            return "1-0"
        if not board.pieces(chess.QUEEN, chess.WHITE) and not board.pieces(chess.ROOK, chess.WHITE):
            return "0-1"
    if not moves(game, board):
        if game.kings and board.is_check():
            return "0-1" if board.turn == chess.WHITE else "1-0"
        return "1/2-1/2"
    return None


def play(game: MiniGame, board: chess.Board, uci: str) -> str | None:
    """Ход игрока (UCI; превращение можно не указывать — ферзь). Возвращает итог после хода."""
    if result(game, board) is not None:
        raise DomainError("mini_game_over")
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise DomainError("mini_game_illegal_move") from None
    piece = board.piece_at(move.from_square)
    if piece and piece.piece_type == chess.PAWN and chess.square_rank(move.to_square) in (0, 7) and move.promotion is None:
        move = chess.Move(move.from_square, move.to_square, promotion=chess.QUEEN)
    if move not in moves(game, board):
        raise DomainError("mini_game_illegal_move")
    board.push(move)
    return result(game, board)


def evaluate(game: MiniGame, board: chess.Board) -> int:
    """Оценка с точки зрения стороны, которая ходит."""
    outcome = result(game, board)
    if outcome is not None:
        score = {"1-0": WIN, "0-1": -WIN, "1/2-1/2": 0}[outcome]
        return score if board.turn == chess.WHITE else -score
    total = 0
    for square, piece in board.piece_map().items():
        value = PIECE_VALUE[piece.piece_type]
        if piece.piece_type == chess.PAWN:
            advance = chess.square_rank(square) if piece.color == chess.WHITE else 7 - chess.square_rank(square)
            value += advance * advance * 6
        if piece.piece_type == chess.KING and game.id == "capture_flag":
            advance = chess.square_rank(square) if piece.color == chess.WHITE else 7 - chess.square_rank(square)
            value += advance * advance * 25
        total += value if piece.color == chess.WHITE else -value
    return total if board.turn == chess.WHITE else -total


def _search(game: MiniGame, board: chess.Board, depth: int, alpha: int, beta: int) -> int:
    if depth == 0 or result(game, board) is not None:
        return evaluate(game, board)
    best = -WIN * 2
    # Сначала взятия и продвижения — отсечения работают лучше.
    ordered = sorted(moves(game, board), key=lambda m: (board.is_capture(m), m.promotion is not None), reverse=True)
    for move in ordered:
        board.push(move)
        score = -_search(game, board, depth - 1, -beta, -alpha)
        board.pop()
        if score > best:
            best = score
        alpha = max(alpha, score)
        if alpha >= beta:
            break
    return best


def bot_move(game: MiniGame, board: chess.Board, depth: int = 3) -> chess.Move | None:
    """Ход бота: лучший по перебору; при равенстве — первый (детерминированно)."""
    best_move, best_score = None, -WIN * 3
    ordered = sorted(moves(game, board), key=lambda m: (board.is_capture(m), m.promotion is not None, m.uci()), reverse=True)
    for move in ordered:
        board.push(move)
        score = -_search(game, board, depth - 1, -WIN * 2, WIN * 2)
        board.pop()
        if score > best_score:
            best_move, best_score = move, score
    return best_move
