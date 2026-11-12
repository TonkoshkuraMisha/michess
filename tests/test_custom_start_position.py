# --- FILE: tests/test_custom_start_position.py ---
"""
Партия с ботом и анализ с произвольной начальной позиции: ходы проверяются от неё, PGN получает
заголовки SetUp/FEN, разбор партии нумерует ходы по доске, невозможные позиции отклоняются.
"""

import io

import chess
import chess.pgn
import pytest

from src.models.game import Game
from src.services.analysis_service import _evaluate_board_sequence_sync
from src.services.game_engine import (
    STARTING_FEN,
    InvalidStartPositionError,
    board_from_start_fen,
    is_standard_start,
)

API = "/api/v1"
# Король и ферзь против короля, ход белых: Qa7# — мат в один ход.
KQ_VS_K = "k7/7Q/1K6/8/8/8/8/8 w - - 0 1"
# Та же идея с ходом чёрных и номером хода 40: партия начинается «с середины».
BLACK_TO_MOVE = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 40"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _save(client, token, **body):
    payload = {"bot_id": "philidor", "player_color": "white", "result": "1-0", **body}
    return client.post(f"{API}/bots/save-game", json=payload, headers=_auth(token))


# --- доска из FEN -------------------------------------------------------------------------


@pytest.mark.parametrize("fen", [None, "", "   ", STARTING_FEN])
def test_missing_or_standard_fen_gives_the_usual_setup(fen):
    board = board_from_start_fen(fen)
    assert board.fen() == STARTING_FEN and is_standard_start(board)


@pytest.mark.parametrize("fen", [
    "not a fen",
    "8/8/8/8/8/8/8/8 w - - 0 1",        # нет королей
    "kK6/8/8/8/8/8/8/8 w - - 0 1",      # короли рядом
    "4k3/8/8/8/8/8/8/r3K3 b - - 0 1",   # белый король под шахом, а ход чёрных
])
def test_impossible_positions_are_rejected(fen):
    with pytest.raises(InvalidStartPositionError):
        board_from_start_fen(fen)


def test_legal_position_with_black_to_move_is_accepted():
    board = board_from_start_fen(BLACK_TO_MOVE)
    assert board.turn == chess.BLACK and board.fullmove_number == 40 and not is_standard_start(board)


# --- сохранение партии с ботом --------------------------------------------------------------


async def test_bot_game_from_a_position_is_saved_with_setup_headers(client, db_session, token_user_1):
    response = _save(client, token_user_1, moves_uci=["h7a7"], start_fen=KQ_VS_K)

    assert response.status_code == 200
    assert response.json()["result"] == "1-0"  # мат найден сервером от заданной позиции

    game = await db_session.get(Game, response.json()["game_id"])
    parsed = chess.pgn.read_game(io.StringIO(game.pgn))
    assert parsed.headers["SetUp"] == "1" and parsed.headers["FEN"] == KQ_VS_K
    assert "ECO" not in parsed.headers and game.eco is None  # у позиции «с середины» дебюта нет
    assert parsed.board().fen() == KQ_VS_K
    assert parsed.end().board().is_checkmate()
    assert game.board_fen == parsed.end().board().fen()


async def test_moves_are_validated_from_the_given_position(client, token_user_1):
    # e2e4 легален в обычной расстановке, но не в позиции «король и ферзь против короля».
    response = _save(client, token_user_1, moves_uci=["e2e4"], start_fen=KQ_VS_K, termination="resignation")
    assert response.status_code == 400
    assert "Нелегальный ход" in response.json()["detail"]


async def test_impossible_start_position_is_a_400(client, token_user_1):
    response = _save(client, token_user_1, moves_uci=["a1a2"], start_fen="kK6/8/8/8/8/8/8/8 w - - 0 1")
    assert response.status_code == 400
    assert "невозможна" in response.json()["detail"]


async def test_standard_fen_is_not_treated_as_a_custom_position(client, db_session, token_user_1):
    response = _save(
        client, token_user_1, moves_uci=["e2e4", "e7e5"], start_fen=STARTING_FEN, termination="resignation",
        result="0-1",
    )
    assert response.status_code == 200
    game = await db_session.get(Game, response.json()["game_id"])
    assert "[FEN" not in game.pgn and game.eco is not None


async def test_game_without_start_fen_is_unchanged(client, db_session, token_user_1):
    response = _save(client, token_user_1, moves_uci=["f2f3", "e7e5", "g2g4", "d8h4"], result="0-1")
    game = await db_session.get(Game, response.json()["game_id"])
    assert response.json()["result"] == "0-1" and "[SetUp" not in game.pgn


# --- анализ ---------------------------------------------------------------------------------


def test_position_analysis_accepts_a_start_position(client):
    response = client.post(f"{API}/analysis/position", json={"moves": ["Qa7#"], "start_fen": KQ_VS_K})

    assert response.status_code == 200
    board = chess.Board(response.json()["fen"])
    assert board.is_checkmate() and board.turn == chess.BLACK


def test_position_analysis_rejects_an_impossible_position(client):
    response = client.post(f"{API}/analysis/position", json={"moves": [], "start_fen": "8/8/8/8/8/8/8/8 w - - 0 1"})
    assert response.status_code == 400


def test_position_analysis_without_start_fen_still_starts_from_the_usual_setup(client):
    response = client.post(f"{API}/analysis/position", json={"moves": ["e4"]})
    assert response.json()["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3/")


def test_full_game_analysis_numbers_moves_from_the_board(monkeypatch):
    """Партия с хода чёрных на 40-м ходу: первый полуход — «40... чёрные», а не «1. белые»."""
    monkeypatch.setattr("src.services.analysis_service.resolve_stockfish_path", lambda: None)
    board = chess.Board(BLACK_TO_MOVE)
    game = chess.pgn.Game()
    game.setup(board)
    node = game
    for uci in ("g8f8", "d1d8", "f8e7"):
        node = node.add_variation(chess.Move.from_uci(uci))

    report = _evaluate_board_sequence_sync(str(game))

    assert [(m["move_number"], m["color"], m["san"]) for m in report["moves"]] == [
        (40, "black", "Kf8"), (41, "white", "Rd8+"), (41, "black", "Ke7"),
    ]
    assert [m["ply"] for m in report["moves"]] == [1, 2, 3]
