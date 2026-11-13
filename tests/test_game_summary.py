# --- FILE: tests/test_game_summary.py ---
"""Итог партии (таск 11.5): тип партии по синтетическим графикам оценки, ключевые моменты, эндпоинт разбора."""

import json

import pytest

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.analysis_service import ANALYSIS_FORMAT_VERSION
from src.services.game_summary import summarize


def moves_from(evals: list[int], losses: dict[int, int] | None = None) -> list[dict]:
    """Ходы разбора по оценкам после каждого полухода (белые — нечётные полуходы). losses: ply → cp_loss."""
    losses = losses or {}
    return [
        {"ply": ply, "color": "white" if ply % 2 else "black", "eval_cp": value, "cp_loss": losses.get(ply, 0)}
        for ply, value in enumerate(evals, start=1)
    ]


def test_domination():
    evals = [20, 30, 60, 50, 120, 110, 200, 190, 300, 280, 450, 430, 700, 690, 1000]
    assert summarize(moves_from(evals), "1-0")["kind"] == "domination"


def test_decisive_blunder_names_the_turning_point():
    evals_white_blunders = [20, 10, 30, 20, 30, 10, -380, -400, -390, -420, -500, -480]
    summary = summarize(moves_from(evals_white_blunders, {7: 390}), "0-1")
    assert summary["kind"] == "decisive_blunder"
    assert summary["turning_point_ply"] == 7
    assert summary["white"]["worst_ply"] == 7


def test_seesaw():
    evals = [0, 50, 200, 210, 180, -250, -240, -260, 300, 320, 500, 520]
    summary = summarize(moves_from(evals, {6: 430, 9: 0}), "1-0")
    assert summary["kind"] == "seesaw" and summary["lead_changes"] == 2


def test_missed_win_in_a_draw():
    evals = [0, 10, 40, 30, 350, 340, 300, 120, 60, 20, 0, 0]
    assert summarize(moves_from(evals, {8: 180}), "1/2-1/2")["kind"] == "missed_win"


def test_balanced():
    evals = [10, 0, 30, 20, -20, 10, 40, 30, 60, 50, 20, 0]
    summary = summarize(moves_from(evals), "1/2-1/2")
    assert summary["kind"] == "balanced" and summary["equal_share"] == 1.0


def test_gradual():
    # Белые в дебюте были заметно хуже (не доминирование), затем без грубых ошибок соперника набрали перевес.
    evals = [-120, -180, -190, -160, -120, -60, 160, 200, 260, 300, 380, 420]
    summary = summarize(moves_from(evals), "1-0")
    assert summary["kind"] == "gradual" and summary["lead_changes"] == 1


def test_key_moments_and_mate_clamp():
    evals = [20, 30, 25, -10000, 10000]
    summary = summarize(moves_from(evals, {4: 900}), "1-0")
    assert summary["black"]["worst_ply"] == 4
    assert summary["white"]["best_ply"] == 5
    assert summary["white"]["worst_ply"] is None


@pytest.mark.parametrize("moves", [[]])
def test_empty_game_has_no_summary(moves):
    assert summarize(moves, "1-0") is None


async def test_cached_analysis_comes_with_a_summary(client, db_session):
    white = User(username="sum_w", hashed_password="pw")
    black = User(username="sum_b", hashed_password="pw")
    db_session.add_all([white, black])
    await db_session.commit()
    pgn = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1'
    moves = [
        {"ply": 1, "move_number": 1, "color": "white", "san": "f3", "uci": "f2f3", "eval_cp": -60,
         "eval_display": "-0.6", "cp_loss": 90, "classification": "Inaccuracy", "symbol": "?!"},
        {"ply": 2, "move_number": 1, "color": "black", "san": "e5", "uci": "e7e5", "eval_cp": -50,
         "eval_display": "-0.5", "cp_loss": 0, "classification": "Best", "symbol": "!"},
        {"ply": 3, "move_number": 2, "color": "white", "san": "g4", "uci": "g2g4", "eval_cp": -10000,
         "eval_display": "#-1", "mate": -1, "cp_loss": 9950, "classification": "Blunder", "symbol": "??"},
        {"ply": 4, "move_number": 2, "color": "black", "san": "Qh4#", "uci": "d8h4", "eval_cp": -10000,
         "eval_display": "#", "cp_loss": 0, "classification": "Best", "symbol": "!"},
    ]
    side = {"accuracy": 50.0, "best": 1, "good": 0, "inaccuracies": 0, "mistakes": 0, "blunders": 0, "avg_cp_loss": 0.0}
    analysis = {"format_version": ANALYSIS_FORMAT_VERSION, "engine": "test",
                "white": side, "black": side, "moves": moves}
    game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED,
                base_time_ms=180000, increment_ms=0, is_rated=False, result="0-1", pgn=pgn,
                analysis_json=json.dumps(analysis))
    db_session.add(game)
    await db_session.commit()

    body = client.get(f"/api/v1/analysis/game/{game.id}").json()
    assert body["summary"]["kind"] == "decisive_blunder"
    assert body["summary"]["turning_point_ply"] == 3


def test_punishing_a_blunder_is_the_best_moment():
    # Детский мат: 3…Кf6?? — уже выигранная позиция, а 4.Фxf7# — ход, который это использовал.
    evals = [30, 25, 30, 40, 50, 10000, 10000]
    summary = summarize(moves_from(evals, {6: 9950}), "1-0")
    assert summary["kind"] == "decisive_blunder" and summary["turning_point_ply"] == 6
    assert summary["white"]["best_ply"] == 7
