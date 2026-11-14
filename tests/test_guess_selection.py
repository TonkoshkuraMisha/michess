# --- FILE: tests/test_guess_selection.py ---
"""«Угадай ход мастера» (таск 14.3): отбор позиций на подменённом выводе движка."""

import chess
import pytest

from src.services.guess_selection import build_series, difficulty, is_obvious, qualifies

# Спокойная позиция 15-го хода (вне дебюта): у белых тихий ход Rd1, взятия не очевидны.
FEN = "r4rk1/pp3ppp/2n1b3/3q4/3P4/2N2N2/PP3PPP/R2Q1RK1 w - - 0 15"
BOARD = chess.Board(FEN)
QUIET, OTHER, THIRD = (BOARD.parse_san(s) for s in ("Re1", "a3", "h3"))


def lines(*pairs):
    return [(move, cp) for move, cp in pairs]


def test_master_move_with_a_clear_gap_qualifies():
    verdict = qualifies(BOARD, QUIET, lines((QUIET, 180), (OTHER, 10), (THIRD, 0)))
    assert verdict is not None and verdict.reason == "gap" and verdict.gap_cp == 170


def test_only_move_that_keeps_the_result_qualifies():
    # Выигрыш только этим ходом: остальные — к равенству, хотя отрыв меньше 150.
    assert qualifies(BOARD, QUIET, lines((QUIET, 160), (OTHER, 40))).reason == "only_move"
    # Равенство только этим ходом: остальные проигрывают.
    assert qualifies(BOARD, QUIET, lines((QUIET, -40), (OTHER, -160))).reason == "only_move"


@pytest.mark.parametrize("pairs", [
    ((QUIET, 60), (OTHER, 20)),       # малый отрыв — ход угадывается, а не находится
    ((OTHER, 300), (QUIET, 50)),      # ход мастера не лучший
    ((QUIET, 1200), (OTHER, 900)),    # и так всё решено: выигрывает что угодно
    ((QUIET, -900), (OTHER, -1200)),  # и так проиграно
])
def test_rejected(pairs):
    assert qualifies(BOARD, QUIET, lines(*pairs)) is None


def test_opening_positions_are_skipped():
    board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    move = board.parse_san("Bb5")
    assert qualifies(board, move, lines((move, 300), (board.parse_san("d4"), 0))) is None


def test_recapture_is_obvious():
    board = chess.Board()
    for san in ("e4", "d5", "exd5"):
        board.push_san(san)
    assert is_obvious(board, board.parse_san("Qxd5"))


def test_taking_a_hanging_piece_is_obvious_but_a_defended_one_is_not():
    hanging = chess.Board("4k3/8/8/3n4/8/8/B7/4K3 w - - 0 30")
    assert is_obvious(hanging, hanging.parse_san("Bxd5"))
    guarded = chess.Board("4k3/8/2p5/3n4/8/8/B7/4K3 w - - 0 30")  # пешка c6 защищает коня
    assert not is_obvious(guarded, guarded.parse_san("Bxd5"))


def test_single_legal_move_is_obvious():
    board = chess.Board("7k/8/8/8/8/8/6q1/7K w - - 0 40")  # шах ферзём, единственный ход — взять его
    assert board.legal_moves.count() == 1
    assert is_obvious(board, next(iter(board.legal_moves)))


def test_series_break_on_opponent_error_and_length_limits():
    assert build_series([21, 23, 25, 31, 33], opponent_errors={24}) == [[21, 23], [31, 33]]
    assert build_series([21, 25], opponent_errors=set()) == []  # не подряд
    assert build_series(list(range(21, 35, 2)), opponent_errors=set()) == [[21, 23, 25, 27, 29, 31]]


def test_quiet_moves_are_harder():
    verdict = qualifies(BOARD, QUIET, lines((QUIET, 180), (OTHER, 10)))
    assert difficulty(BOARD, QUIET, verdict) > 1500
