# --- FILE: tests/test_mini_games.py ---
"""Игры тренеров (таск 19.8): правила окончания каждой игры, ходы по правилам, бот, API."""

import chess
import pytest

from src.core.errors import DomainError
from src.services import mini_games as mg


def finish(game_id: str, fen: str, uci: str) -> str | None:
    game = mg.get_game(game_id)
    return mg.play(game, mg.board_of(game, fen), uci)


def test_start_positions_are_playable():
    for game in mg.GAMES.values():
        board = mg.board_of(game, game.fen)
        assert mg.result(game, board) is None
        assert mg.moves(game, board), game.id


def test_pawn_war_endings():
    assert finish("pawn_war", "8/P7/8/8/8/8/7p/8 w - - 0 1", "a7a8") == "1-0"           # пешка дошла
    assert finish("pawn_war", "8/8/8/8/8/1p6/P7/8 w - - 0 1", "a2b3") == "1-0"          # съедена последняя пешка
    # Ходов нет — ничья: пешки упёрлись друг в друга.
    assert mg.result(mg.GAMES["pawn_war"], chess.Board("8/8/8/4p3/4P3/8/8/8 w - - 0 1")) == "1/2-1/2"


def test_king_pawns_and_capture_flag_endings():
    assert finish("king_pawns", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8") == "1-0"
    assert finish("capture_flag", "7k/8/3K4/8/8/8/8/8 w - - 0 1", "d6d7") is None
    assert finish("capture_flag", "8/3K4/8/8/7k/8/8/8 w - - 0 1", "d7d8") == "1-0"
    assert finish("capture_flag", "8/8/8/8/8/8/3k4/7K b - - 0 1", "d2d1") == "0-1"
    # В игре с королями под шах ходить нельзя.
    with pytest.raises(DomainError):
        finish("king_pawns", "4k3/8/8/8/8/3p4/8/4K3 w - - 0 1", "e1e2")   # пешка d3 бьёт e2


def test_queen_and_rook_vs_pawns_endings():
    assert finish("queen_vs_pawns", "8/8/8/8/8/8/p7/Q7 w - - 0 1", "a1a2") == "1-0"   # последняя пешка съедена
    assert finish("queen_vs_pawns", "8/8/8/8/8/8/p7/7Q b - - 0 1", "a2a1") == "0-1"   # пешка дошла
    assert finish("rook_vs_pawns", "8/8/8/8/8/8/1p6/R7 b - - 0 1", "b2a1") == "0-1"   # пешка взяла ладью с превращением
    assert finish("rook_vs_pawns", "8/8/8/8/8/1p6/8/1R6 w - - 0 1", "b1b3") == "1-0"


def test_illegal_moves_and_finished_game():
    with pytest.raises(DomainError):
        finish("pawn_war", mg.GAMES["pawn_war"].fen, "e2e5")
    with pytest.raises(DomainError):
        finish("pawn_war", mg.GAMES["pawn_war"].fen, "zzzz")
    with pytest.raises(DomainError):
        finish("pawn_war", "8/8/8/8/8/1p6/8/8 w - - 0 1", "a2a3")   # белых пешек нет — игра уже окончена
    with pytest.raises(DomainError):
        mg.get_game("chess960")


def test_bot_takes_the_win_and_stops_promotion():
    game = mg.GAMES["pawn_war"]
    assert mg.bot_move(game, chess.Board("8/P7/8/8/8/8/1p6/8 w - - 0 1")).uci() == "a7a8q"
    # Ферзь против пешек: пешка готова превратиться — ферзь её берёт.
    queen = mg.GAMES["queen_vs_pawns"]
    board = chess.Board("8/8/8/8/8/8/p7/1Q6 w - - 0 1")
    assert mg.bot_move(queen, board).uci() == "b1a2"


def test_api_play_against_bot(client):
    listing = client.get("/api/v1/mini-games").json()
    assert {g["id"] for g in listing["games"]} == set(mg.GAMES)
    fen = mg.GAMES["pawn_war"].fen
    start = client.post("/api/v1/mini-games/pawn_war/move", json={"fen": fen, "move": "e2e4", "bot": True}).json()
    assert start["result"] is None and start["bot_move"] and start["fen"].split(" ")[1] == "w"
    hotseat = client.post("/api/v1/mini-games/pawn_war/move", json={"fen": fen, "move": "e2e4", "bot": False}).json()
    assert hotseat["bot_move"] is None and hotseat["fen"].split(" ")[1] == "b"
    bad = client.post("/api/v1/mini-games/pawn_war/move", json={"fen": mg.GAMES["pawn_war"].fen, "move": "e2e5"})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "mini_game_illegal_move"
    first = client.post("/api/v1/mini-games/capture_flag/bot-first", json={"fen": mg.GAMES["capture_flag"].fen}).json()
    assert first["bot_move"] and first["fen"].split(" ")[1] == "b"
