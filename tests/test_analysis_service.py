# --- FILE: tests/test_analysis_service.py ---

import pytest
from src.services.analysis_service import (
    calculate_accuracy,
    classify_move_by_cp_loss,
    _evaluate_board_sequence_sync,
)


def test_classify_move_by_cp_loss_thresholds():
    assert classify_move_by_cp_loss(0, is_best_move=True) == ("Best", "!")
    assert classify_move_by_cp_loss(8) == ("Best", "!")
    assert classify_move_by_cp_loss(25) == ("Good", "")
    assert classify_move_by_cp_loss(70) == ("Inaccuracy", "?!")
    assert classify_move_by_cp_loss(140) == ("Mistake", "?")
    assert classify_move_by_cp_loss(320) == ("Blunder", "??")


def test_calculate_accuracy_bounds_and_monotonicity():
    perfect = calculate_accuracy([0, 0, 5, 0])
    decent = calculate_accuracy([15, 35, 60, 20])
    blunder_heavy = calculate_accuracy([250, 400, 310, 500])

    assert 95.0 <= perfect <= 100.0
    assert decent < perfect
    assert blunder_heavy < decent
    assert 0.0 <= blunder_heavy <= 100.0


@pytest.mark.asyncio
async def test_evaluate_board_sequence_fools_mate():
    sample_pgn = (
        '[Event "Test Game"]\n'
        '[White "Player1"]\n'
        '[Black "Player2"]\n'
        '[Result "0-1"]\n\n'
        '1. f3 e5 2. g4 Qh4# 0-1\n'
    )
    report = _evaluate_board_sequence_sync(sample_pgn, depth=5)

    assert "white" in report and "black" in report
    assert len(report["moves"]) == 4
    assert report["moves"][-1]["san"] == "Qh4#"
    assert report["moves"][-1]["eval_cp"] <= -900
    assert 0.0 <= report["white"]["accuracy"] <= 100.0
    assert 0.0 <= report["black"]["accuracy"] <= 100.0
