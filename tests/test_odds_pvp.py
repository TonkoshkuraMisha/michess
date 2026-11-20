"""
Фора в партии с человеком (21.1, сеть): позиция из приглашения, ходы от неё, PGN с FEN, без рейтинга, фора по
времени, «песочные часы».
"""

import time

import chess
import pytest

from src.api.websockets import create_rematch_game
from src.models.game import Game
from src.services import odds
from src.services.game_engine import restore_board
from src.services.game_state import state_manager
from src.services.matchmaker import matchmaker
from tests.test_casual_games import TC, _users
from tests.test_chess960_pvp import _Recorder


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

def test_hourglass_clock_rules():
    """«Песочные часы»: потраченное ходящим уходит сопернику; без них — только добавка ходившему."""
    from src.services.game_state import clocks_after_move, live_clock_ms

    assert clocks_after_move(60000, 60000, 7000, 2000, hourglass=True) == (55000, 67000)
    assert clocks_after_move(60000, 60000, 7000, 2000, hourglass=False) == (55000, 60000)
    state = {"white_time_ms": "60000", "black_time_ms": "50000", "last_move_at": "1000", "turn": "white",
             "hourglass": "1"}
    assert (live_clock_ms(state, "white", 5000), live_clock_ms(state, "black", 5000)) == (56000, 54000)
    state["hourglass"] = "0"
    assert live_clock_ms(state, "black", 5000) == 50000


async def test_invite_with_hourglass(db_session):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, 180000, 0, color_pref="white", rated=True,
                                                    odds_kind="hourglass")
    assert invite["rated"] is False
    started = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)
    game = await db_session.get(Game, started["game_id"])
    assert game.hourglass is True and game.initial_fen is None and game.is_rated is False

    # Белые думали 10 секунд: столько же прибавилось чёрным.
    now_ms = int(time.time() * 1000)
    await state_manager.update_game_state(started["game_id"], {"last_move_at": now_ms - 10000})
    res = await state_manager.process_atomic_move(started["game_id"], a.id, "c1", "e2e4")
    assert res["status"] == "success", res
    white, black = res["white_time_ms"], res["black_time_ms"]
    assert 169000 <= white <= 170000 and 190000 <= black <= 191000 and white + black == 360000


async def test_match_found_and_rematch_keep_hourglass(db_session):
    a, b = await _users(db_session, 1500, 1500)
    recorder = _Recorder()
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, odds_kind="hourglass")
    first = await matchmaker.start_game_from_invite(invite["code"], b.id, connection_manager=recorder, db=db_session)
    found = [m for _, m in recorder.sent if m.get("event") == "match_found"]
    assert len(found) == 2 and all(m["hourglass"] is True for m in found)

    prev_state = await state_manager.get_game_state(first["game_id"])
    await state_manager.claim_game_end(first["game_id"], "1-0", "resignation")
    await state_manager.finish_game(db_session, first["game_id"], "1-0", termination="resignation")
    rematch = await create_rematch_game(db_session, prev_state)
    game = await db_session.get(Game, rematch["game_id"])
    assert game.hourglass is True and game.is_rated is False
