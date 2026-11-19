"""Шахматы Фишера с человеком (21.3 / 21.1, сеть): приглашение, позиция 960, рокировка по правилам 960, PGN."""

import io

import chess
import chess.pgn

from src.api.websockets import create_rematch_game
from src.models.game import Game
from src.services.game_engine import engine, fen_of, is_chess960_fen, restore_board, start_fen_of
from src.services.game_state import state_manager
from src.services.matchmaker import chess960_start, matchmaker
from src.services.odds import pgn_header
from tests.test_casual_games import TC, _users

STANDARD_960 = fen_of(chess.Board.from_chess960_pos(518))  # обычная расстановка по правилам 960


def test_chess960_fen_is_recognisable():
    assert STANDARD_960.split()[2] == "HAha" and is_chess960_fen(STANDARD_960)
    assert not is_chess960_fen(chess.STARTING_FEN) and not is_chess960_fen("8/8/8/8/8/8/8/K6k w - - 0 1")
    for number in (0, 100, 959):
        fen = chess960_start(number)
        assert is_chess960_fen(fen) and chess.Board(fen, chess960=True).is_valid()
    assert pgn_header(STANDARD_960).startswith('[Variant "Chess960"]')
    assert not pgn_header(chess.STARTING_FEN).startswith("[Variant")


def test_engine_castles_king_takes_rook_and_keeps_960_rules():
    fen, pgn = STANDARD_960, pgn_header(STANDARD_960)
    for uci in ("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"):
        ok, data = engine.process_move(fen, uci, pgn)
        assert ok, uci
        fen, pgn = data["new_fen"], data["new_pgn"]
    ok, data = engine.process_move(fen, "e1g1", pgn)
    assert not ok  # в 960 рокировка — «король берёт свою ладью»
    ok, data = engine.process_move(fen, "e1h1", pgn)
    assert ok and data["san"] == "O-O"
    board = restore_board(data["new_fen"], data["new_pgn"])
    assert board.chess960 and board.piece_at(chess.G1) == chess.Piece(chess.KING, chess.WHITE)
    assert is_chess960_fen(data["new_fen"])  # права чёрных на рокировку — снова буквами вертикалей


async def test_chess960_invite_game(db_session):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, color_pref="white", rated=True,
                                                    odds_kind="queen", variant="chess960")
    assert invite["variant"] == "chess960" and invite["rated"] is False and invite["odds_kind"] == ""
    started = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)
    game = await db_session.get(Game, started["game_id"])
    assert is_chess960_fen(game.initial_fen) and game.is_rated is False
    state = await state_manager.get_game_state(started["game_id"])
    assert state["board_fen"] == game.initial_fen and state["pgn"].startswith('[Variant "Chess960"]')

    start = chess.Board(game.initial_fen, chess960=True)
    move = next(m for m in start.legal_moves if not start.is_castling(m))
    res = await state_manager.process_atomic_move(started["game_id"], a.id, "c1", move.uci())
    assert res["status"] == "success", res

    await state_manager.finish_game(db_session, started["game_id"], "0-1", "resignation")
    await db_session.refresh(game)
    parsed = chess.pgn.read_game(io.StringIO(game.pgn))
    assert parsed.headers.get("Variant") == "Chess960" and parsed.board().chess960
    assert [m.uci() for m in parsed.mainline_moves()] == [move.uci()]


async def test_unknown_variant_is_standard(db_session):
    a, _ = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, variant="crazyhouse")
    assert invite["variant"] == "standard" and invite["rated"] is True


class _Recorder:
    def __init__(self):
        self.sent: list[tuple[int, dict]] = []

    async def send_personal_message(self, message: dict, user_id: int) -> None:
        self.sent.append((user_id, message))

    async def is_user_online(self, user_id: int) -> bool:
        return True


async def test_match_found_tells_the_client_it_is_chess960(db_session):
    a, b = await _users(db_session, 1500, 1500)
    recorder = _Recorder()
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, variant="chess960")
    await matchmaker.start_game_from_invite(invite["code"], b.id, connection_manager=recorder, db=db_session)
    found = [m for _, m in recorder.sent if m.get("event") == "match_found"]
    assert len(found) == 2 and {m["variant"] for m in found} == {"chess960"}
    assert is_chess960_fen(found[0]["fen"]) and found[0]["pgn"].startswith('[Variant "Chess960"]')


async def test_rematch_of_a_chess960_game_is_chess960_with_the_same_position(db_session):
    a, b = await _users(db_session, 1500, 1500)
    invite = await matchmaker.create_private_invite(a.id, "a", 1500, *TC, color_pref="white", variant="chess960")
    first = await matchmaker.start_game_from_invite(invite["code"], b.id, db=db_session)
    prev_state = await state_manager.get_game_state(first["game_id"])
    first_game = await db_session.get(Game, first["game_id"])
    await state_manager.claim_game_end(first["game_id"], "1-0", "resignation")
    await state_manager.finish_game(db_session, first["game_id"], "1-0", termination="resignation")

    rematch = await create_rematch_game(db_session, prev_state)

    game = await db_session.get(Game, rematch["game_id"])
    # Та же расстановка 960, цвета поменялись, без рейтинга — как первая партия.
    assert game.initial_fen == first_game.initial_fen and is_chess960_fen(game.initial_fen)
    assert (game.white_player_id, game.black_player_id) == (first_game.black_player_id, first_game.white_player_id)
    assert game.is_rated is False
    state = await state_manager.get_game_state(rematch["game_id"])
    assert state["pgn"].startswith('[Variant "Chess960"]')


def test_start_fen_is_read_from_the_pgn_header():
    assert start_fen_of(pgn_header(STANDARD_960)) == STANDARD_960
    assert start_fen_of("1. e4 e5 *") is None and start_fen_of(None) is None

