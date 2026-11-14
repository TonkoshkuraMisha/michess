# --- FILE: tests/test_style_metrics.py ---
"""Метрики стиля по партиям калибровки (таск B.5): жертвы, размены, шахи, давление на короля, штурм."""

import io

import chess
import chess.pgn

from scripts.calibrate_bots import Spec, game_pgn
from scripts.style_metrics import collect, game_stats, king_zone_attacks, report

LEGAL_MATE = "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0"
EXCHANGE_RUY = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 *"


def _game(moves: str) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(moves))
    assert game is not None
    return game


def test_queen_sacrifice_is_counted_for_the_side_that_gave_material():
    stats = game_stats(_game(LEGAL_MATE), from_ply=0)
    white, black = stats[chess.WHITE], stats[chess.BLACK]
    assert white.sacrifices == 1  # 5.Nxe5: ферзь отдан, и через ход материал не отыгран
    assert black.sacrifices == 0  # взять ферзя — не жертва
    assert white.checks == 2 and black.checks == 0
    assert white.king_pressure > black.king_pressure


def test_equal_trade_with_recapture_and_pawn_takes_are_told_apart():
    stats = game_stats(_game(EXCHANGE_RUY), from_ply=0)
    assert stats[chess.WHITE].trades == 1  # слон за коня с отыгрышем на c6
    assert stats[chess.BLACK].trades == 0  # пешка берёт слона — не равный размен
    assert stats[chess.WHITE].sacrifices == stats[chess.BLACK].sacrifices == 0


def test_pawn_storm_counts_advances_past_the_middle_near_the_enemy_king():
    stats = game_stats(_game("1. f4 e5 2. f5 a5 3. a4 *"), from_ply=0)
    assert stats[chess.WHITE].storm == 1  # f5 — рядом с королём e8; f4 ещё на своей половине, a4 — далеко
    assert stats[chess.BLACK].storm == 0


def test_only_the_middlegame_is_counted():
    assert game_stats(_game(LEGAL_MATE))[chess.WHITE].moves == 0  # партия кончилась раньше MIDDLEGAME_FROM_PLY


def test_king_zone_attacks():
    board = chess.Board("6k1/5pp1/8/7Q/8/8/5PPP/6K1 w - - 0 1")
    assert king_zone_attacks(board, chess.WHITE) == 3  # ферзь h5 бьёт h7, h8 (по вертикали) и f7 (по диагонали)
    assert king_zone_attacks(board, chess.BLACK) == 0


def test_calibration_pgn_feeds_the_metrics(tmp_path):
    board = _game(LEGAL_MATE).end().board()  # с полным стеком ходов, как в play_game
    path = tmp_path / "style.pgn"
    path.write_text(game_pgn(Spec("morphy", "anchor:1850", 0), board, "1-0") + "\n\n", encoding="utf-8")

    totals = collect(path, from_ply=0)
    assert totals["morphy"].sacrifices == 1 and totals["morphy"].opponents == {"anchor:1850"}
    text = report(totals)
    assert "morphy" in text and "anchor:1850" not in text  # якоря — только по --anchors
