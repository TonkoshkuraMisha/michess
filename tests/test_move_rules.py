# --- FILE: tests/test_move_rules.py ---
"""
Правила ходов на сервере (GameEngine.process_move — проверка каждого хода партии): особые ходы, запрещённые ходы,
ввод в разных записях и мусор, все виды окончания партии. Сервер — единственный судья: клиенту верить нельзя.
"""

import chess
import pytest

from src.services.game_engine import engine

START = chess.STARTING_FEN
CASTLING = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"
CASTLING_BLACK = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1"
EN_PASSANT = "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"
PROMOTION = "1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1"


def _play(fen: str, move: str, pgn: str = "") -> dict | None:
    ok, data = engine.process_move(fen, move, pgn)
    assert ok == (data is not None)
    return data


def _board(data: dict) -> chess.Board:
    return chess.Board(data["new_fen"])


# --- особые ходы ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize(("fen", "uci", "san", "king", "rook"), [
    (CASTLING, "e1g1", "O-O", "g1", "f1"),
    (CASTLING, "e1c1", "O-O-O", "c1", "d1"),
    (CASTLING_BLACK, "e8g8", "O-O", "g8", "f8"),
    (CASTLING_BLACK, "e8c8", "O-O-O", "c8", "d8"),
])
def test_castling_moves_king_and_rook(fen, uci, san, king, rook):
    data = _play(fen, uci)
    assert data["san"] == san and data["uci"] == uci
    board = _board(data)
    assert board.piece_at(chess.parse_square(king)).piece_type == chess.KING
    assert board.piece_at(chess.parse_square(rook)).piece_type == chess.ROOK


@pytest.mark.parametrize("notation", ["O-O", "0-0", "e1g1"])
def test_castling_accepts_san_and_uci(notation):
    assert _play(CASTLING, notation)["uci"] == "e1g1"


def test_castling_loses_rights_for_both_sides_of_the_king():
    board = _board(_play(CASTLING, "e1g1"))
    assert not board.has_castling_rights(chess.WHITE)
    assert board.has_castling_rights(chess.BLACK)


def test_en_passant_removes_the_passed_pawn():
    data = _play(EN_PASSANT, "e5d6")
    assert data["san"] == "exd6"
    board = _board(data)
    assert board.piece_at(chess.D5) is None and board.piece_at(chess.D6).piece_type == chess.PAWN


@pytest.mark.parametrize(("uci", "piece", "san"), [
    ("a7a8q", chess.QUEEN, "a8=Q"),
    ("a7a8r", chess.ROOK, "a8=R"),
    ("a7a8b", chess.BISHOP, "a8=B"),
    ("a7a8n", chess.KNIGHT, "a8=N"),
    ("a7b8q", chess.QUEEN, "axb8=Q+"),
    ("a7b8n", chess.KNIGHT, "axb8=N"),
])
def test_every_promotion_piece_with_and_without_capture(uci, piece, san):
    data = _play(PROMOTION, uci)
    assert data["san"] == san
    assert _board(data).piece_at(chess.parse_square(uci[2:4])).piece_type == piece


def test_san_input_is_accepted():
    data = _play(START, "Nf3")
    assert data["uci"] == "g1f3" and data["san"] == "Nf3"


def test_check_is_marked_in_san():
    assert _play("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")["san"] == "Ra8+"


# --- запрещённые ходы ----------------------------------------------------------------------------------------

@pytest.mark.parametrize(("fen", "move", "why"), [
    ("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1", "e1g1", "рокировка через битое поле"),
    ("r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1", "e1g1", "рокировка на битое поле"),
    ("r3k2r/8/8/8/8/4r3/8/R3K2R w KQkq - 0 1", "e1g1", "рокировка из-под шаха"),
    ("r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1", "e1g1", "права на рокировку утрачены"),
    ("r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1", "e1c1", "фигура между королём и ладьёй"),
    ("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3", "e5d6", "взятие на проходе — только сразу"),
    ("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1", "e2d3", "связанная фигура уходит с линии"),
    ("4k3/8/8/8/8/8/3r4/4K3 w - - 0 1", "e1e2", "король под шах"),
    ("4k3/8/8/8/8/8/8/r3K2N w - - 0 1", "h1g3", "шах не отражён"),
    (PROMOTION, "a7a8", "превращение без фигуры"),
    (PROMOTION, "a7a8k", "превращение в короля"),
    (PROMOTION, "a7a8p", "превращение в пешку"),
    (START, "e2e5", "пешка на три поля"),
    (START, "e3e4", "с пустого поля"),
    (START, "e7e5", "ход чужой фигурой"),
    (START, "g1g3", "конь ходит не буквой Г"),
    (START, "d1d3", "ферзь сквозь свою пешку"),
    (START, "e2d3", "пешка бьёт пустое поле"),
])
def test_illegal_moves_are_rejected(fen, move, why):
    board = chess.Board(fen)
    try:
        assert chess.Move.from_uci(move) not in board.legal_moves, f"тестовые данные: ход легален ({why})"
    except chess.InvalidMoveError:
        pass
    assert _play(fen, move) is None, why


@pytest.mark.parametrize(("fen", "move", "why"), [
    ("4k3/8/8/8/8/8/8/4K2r w - - 0 1", "e1f2", "уход от шаха с линии ладьи"),
    ("4k3/8/8/8/8/8/4p3/4K3 w - - 0 1", "e1e2", "король берёт незащищённую пешку"),
    ("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1", "e2e1", "связанная фигура? нет — слон не ходит по вертикали"),
    ("4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1", "e2e7", "связанная ладья бьёт вдоль линии связки"),
])
def test_legal_neighbours_of_forbidden_moves_are_accepted(fen, move, why):
    board = chess.Board(fen)
    expected = chess.Move.from_uci(move) in board.legal_moves
    assert (_play(fen, move) is not None) == expected, why


@pytest.mark.parametrize("garbage", ["", " ", "e2", "e2e4e5", "e9e4", "i2i4", "Nf9", "xx", "0000", "e2-e4!!", "E2E4"])
def test_garbage_input_is_rejected(garbage):
    assert _play(START, garbage) is None


def test_no_moves_after_checkmate():
    mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"
    assert chess.Board(mated).is_checkmate()
    for move in ("e1f2", "g2g3", "a2a3"):
        assert _play(mated, move) is None


def test_invalid_fen_is_rejected_not_crashing():
    assert engine.process_move("not a fen", "e2e4") == (False, None)


# --- окончание партии ----------------------------------------------------------------------------------------

@pytest.mark.parametrize(("fen", "move", "result", "termination"), [
    ("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2", "d8h4", "0-1", "checkmate"),
    ("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 3", "f3f7", "1-0", "checkmate"),
    ("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1a8", "1-0", "checkmate"),
    ("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", "f1f7", "1/2-1/2", "stalemate"),
    ("8/8/8/8/8/1qk5/8/K1N5 w - - 0 1", "c1b3", "1/2-1/2", "insufficient_material"),
    ("8/8/8/8/2k5/3n4/4B3/K7 w - - 0 1", "e2d3", "1/2-1/2", "insufficient_material"),
    ("8/8/8/4k3/8/8/4K3/7R w - - 99 80", "h1h2", "1/2-1/2", "50_move_rule"),
])
def test_game_endings(fen, move, result, termination):
    data = _play(fen, move)
    assert data["is_game_over"] and data["result"] == result and data["termination"] == termination


def test_ordinary_move_does_not_end_the_game():
    data = _play(START, "e2e4")
    assert not data["is_game_over"] and data["result"] is None and data["termination"] is None


def test_obvious_flag_only_with_a_single_legal_move():
    only = "7k/8/8/8/8/8/6q1/7K w - - 0 1"  # единственный ход — король берёт ферзя
    assert chess.Board(only).legal_moves.count() == 1
    assert _play(only, "h1g2")["is_obvious"]
    assert not _play(START, "e2e4")["is_obvious"]


# --- PGN ведётся вместе с позицией ---------------------------------------------------------------------------

def test_pgn_numbering_through_a_game():
    fen, pgn = START, ""
    for move in ("e2e4", "e7e5", "g1f3", "b8c6", "f1b5"):
        data = _play(fen, move, pgn)
        fen, pgn = data["new_fen"], data["new_pgn"]
    assert pgn == "1. e4 e5 2. Nf3 Nc6 3. Bb5"


def test_pgn_from_a_black_to_move_position():
    data = _play("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "e7e5")
    assert data["new_pgn"] == "1... e5"
