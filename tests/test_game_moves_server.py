# --- FILE: tests/test_game_moves_server.py ---
"""
Ходы партии на сервере (process_atomic_move — путь каждого хода по WebSocket): очередь игроков, особые ходы внутри
партии (рокировка, взятие на проходе, превращение), запись PGN, версия позиции, повтор команды, запрещённые ходы,
мат и пат завершают партию, после конца ходы не принимаются.
"""

import chess
import pytest

from src.services.game_state import state_manager

WHITE, BLACK, STRANGER = 101, 202, 303


@pytest.fixture
async def game():
    await state_manager.initialize_game(game_id=901, white_id=WHITE, black_id=BLACK, base_time_ms=600_000,
                                        increment_ms=0)
    return 901


_counter = 0


async def _move(game_id: int, user_id: int, uci: str, expected_version: int | None = None, command_id: str | None = None):
    global _counter
    _counter += 1
    return await state_manager.process_atomic_move(
        game_id=game_id, user_id=user_id, command_id=command_id or f"cmd-{_counter}", move_str=uci,
        expected_version=expected_version,
    )


async def _play_line(game_id: int, line: list[str]) -> dict:
    result = {}
    for i, uci in enumerate(line):
        result = await _move(game_id, WHITE if i % 2 == 0 else BLACK, uci)
        assert result["status"] in ("success", "game_over"), (uci, result)
    return result


async def _set_position(game_id: int, fen: str) -> None:
    turn = "white" if fen.split()[1] == "w" else "black"
    await state_manager.update_game_state(game_id, {"board_fen": fen, "pgn": "", "turn": turn, "state_version": 4})


async def _state(game_id: int) -> dict:
    return await state_manager.get_game_state(game_id)


async def test_opening_with_castling_is_recorded(game):
    await _play_line(game, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "e1g1", "g8f6"])
    state = await _state(game)
    assert state["pgn"] == "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6"
    assert state["board_fen"].startswith("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq")
    assert state["turn"] == "white" and int(state["state_version"]) == 8


async def test_queenside_castling_for_black(game):
    await _play_line(game, ["d2d4", "d7d5", "c2c4", "c8f5", "b1c3", "b8c6", "c1f4", "d8d7", "e2e3", "e8c8"])
    assert (await _state(game))["pgn"].endswith("5. e3 O-O-O")


async def test_en_passant_in_a_game(game):
    await _play_line(game, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"])
    state = await _state(game)
    assert state["pgn"].endswith("3. exd6")
    board = chess.Board(state["board_fen"])
    assert board.piece_at(chess.D6) == chess.Piece(chess.PAWN, chess.WHITE) and board.piece_at(chess.D5) is None


async def test_en_passant_expires_after_one_move(game):
    await _play_line(game, ["e2e4", "a7a6", "e4e5", "d7d5", "h2h3", "h7h6"])
    assert (await _move(game, WHITE, "e5d6"))["reason"] == "illegal_move"


@pytest.mark.parametrize(("promotion", "piece"), [("q", "Q"), ("r", "R"), ("b", "B"), ("n", "N")])
async def test_promotion_in_a_game(game, promotion, piece):
    await _set_position(game, "4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    result = await _move(game, WHITE, f"a7a8{promotion}")
    assert result["status"] in ("success", "game_over")
    state = await _state(game)
    assert state["board_fen"].startswith(f"{piece}3k3/")
    assert state["pgn"].endswith(f"a8={piece}") or state["pgn"].endswith(f"a8={piece}+")


async def test_promotion_without_piece_is_illegal(game):
    await _set_position(game, "4k3/P7/8/8/8/8/8/4K3 w - - 0 1")
    assert (await _move(game, WHITE, "a7a8"))["reason"] == "illegal_move"


async def test_only_the_side_to_move_can_move(game):
    assert (await _move(game, BLACK, "e7e5"))["reason"] == "not_your_turn"
    assert (await _move(game, STRANGER, "e2e4"))["reason"] == "not_your_turn"
    await _move(game, WHITE, "e2e4")
    assert (await _move(game, WHITE, "d2d4"))["reason"] == "not_your_turn"


async def test_moving_opponent_pieces_is_illegal(game):
    assert (await _move(game, WHITE, "e7e5"))["reason"] == "illegal_move"
    state = await _state(game)
    assert int(state["state_version"]) == 0 and state["pgn"] == ""


@pytest.mark.parametrize("bad", ["", "e2", "e2e5", "zz99", "O-O", "e1g1"])
async def test_illegal_moves_leave_the_state_untouched(game, bad):
    before = await _state(game)
    assert (await _move(game, WHITE, bad))["status"] == "error"
    after = await _state(game)
    assert after["board_fen"] == before["board_fen"] and after["state_version"] == before["state_version"]


async def test_stale_version_is_rejected_with_the_current_position(game):
    await _move(game, WHITE, "e2e4", expected_version=0)
    result = await _move(game, BLACK, "e7e5", expected_version=0)  # клиент не видел хода белых
    assert result["reason"] == "version_mismatch" and result["state_version"] == 1
    assert "4P3" in result["fen"]
    assert (await _move(game, BLACK, "e7e5", expected_version=1))["status"] == "success"


async def test_repeated_command_is_applied_once(game):
    first = await _move(game, WHITE, "e2e4", command_id="same")
    again = await _move(game, WHITE, "e2e4", command_id="same")
    assert first["status"] == "success" and again["status"] == "ignored"
    assert int((await _state(game))["state_version"]) == 1


async def test_checkmate_ends_the_game_and_further_moves_are_refused(game):
    result = await _play_line(game, ["f2f3", "e7e5", "g2g4", "d8h4"])
    assert result["status"] == "game_over" and result["result"] == "0-1" and result["termination"] == "checkmate"
    assert (await _state(game))["status"] == "completed"
    assert (await _move(game, WHITE, "a2a3"))["reason"] == "game_inactive"


async def test_stalemate_is_a_draw(game):
    await _set_position(game, "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1")
    result = await _move(game, WHITE, "f1f7")
    assert result["status"] == "game_over" and result["result"] == "1/2-1/2" and result["termination"] == "stalemate"


async def test_clock_is_charged_to_the_mover_only(game):
    await _move(game, WHITE, "e2e4")
    state = await _state(game)
    assert int(state["black_time_ms"]) == 600_000
    assert int(state["white_time_ms"]) <= 600_000
