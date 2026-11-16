"""Фора в партии с человеком (21.1, сеть): позиция из приглашения, ходы от неё, PGN с FEN, без рейтинга, фора по времени."""

import chess
import pytest

from src.models.game import Game
from src.services import odds
from src.services.game_engine import restore_board
from src.services.game_state import state_manager
from src.services.matchmaker import matchmaker
from tests.test_casual_games import TC, _users


def test_odds_positions_and_times():
    knight = chess.Board(odds.odds_fen("knight", chess.WHITE))
    assert knight.piece_at(chess.B1) is None and knight.piece_at(chess.B8) is not None
    rook = chess.Board(odds.odds_fen("rook", chess.BLACK))
    assert rook.piece_at(chess.A8) is None and not rook.has_queenside_castling_rights(chess.BLACK)
    assert odds.odds_fen("time", chess.WHITE) is None
    assert odds.odds_times("time", chess.WHITE, 180000) == (60000, 180000)
    assert odds.odds_times("knight", chess.WHITE, 180000) == (180000, 180000)


@pytest.mark.parametrize("giver", ["creator", "acceptor"])
async def test_invite_with_material_odds(db_session, giver):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, color_pref="white", rated=True,
                                                    odds_kind="queen", odds_giver=giver)
    assert invite["rated"] is False  # с форой — без рейтинга
    started = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)
    game = await db_session.get(Game, started["game_id"])
    giver_color = chess.WHITE if giver == "creator" else chess.BLACK  # создатель играет белыми
    assert game.initial_fen == odds.odds_fen("queen", giver_color) and game.is_rated is False
    state = await state_manager.get_game_state(started["game_id"])
    assert state["board_fen"] == game.initial_fen and state["pgn"].startswith('[SetUp "1"]')

    res = await state_manager.process_atomic_move(started["game_id"], a.id, "c1", "e2e4")
    assert res["status"] == "success", res
    state = await state_manager.get_game_state(started["game_id"])
    assert state["pgn"].endswith("\n\n1. e4")
    board = restore_board(state["board_fen"], state["pgn"])
    assert board.move_stack and board.root().fen() == game.initial_fen

    await state_manager.finish_game(db_session, started["game_id"], "0-1", "resignation")
    await db_session.refresh(game)
    assert f'[FEN "{game.initial_fen}"]' in game.pgn and "1. e4" in game.pgn


async def test_invite_with_time_odds(db_session):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, 300000, 0, color_pref="black",
                                                    odds_kind="time", odds_giver="creator")
    started = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)
    state = await state_manager.get_game_state(started["game_id"])
    assert (int(state["white_time_ms"]), int(state["black_time_ms"])) == (300000, 100000)
    assert state["board_fen"] == chess.STARTING_FEN and state["pgn"] == ""


async def test_unknown_odds_are_ignored(db_session):
    a, _ = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, odds_kind="two_queens")
    assert invite["odds_kind"] == "" and invite["rated"] is True
