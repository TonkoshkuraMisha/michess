# --- FILE: tests/test_labourdonnais_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.labourdonnais import (
    LABOURDONNAIS_OPENING_BOOK,
    LabourdonnaisBot,
    evaluate_labourdonnais_style_bonus,
)
from src.services.bots.philidor import normalize_fen_key


def test_labourdonnais_opening_repertoire_branches():
    """Проверяем, что в книге Лабурдонне сохранены все стартовые ветки (e4, d4, f4)."""
    bot = LabourdonnaisBot(stockfish_path=None)
    board = chess.Board()
    start_key = normalize_fen_key(board)
    expected_book_moves = {item[0] for item in LABOURDONNAIS_OPENING_BOOK[start_key]}

    assert {"e2e4", "d2d4", "f2f4"}.issubset(expected_book_moves)

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_book_moves
    assert result["source"] == "opening_book"


def test_labourdonnais_plays_evans_gambit_or_italian_from_book():
    """Проверяем, что в итальянской позиции Лабурдонне выбирает гамбит Эванса (b2b4) или c2c3."""
    bot = LabourdonnaisBot(stockfish_path=None)
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]:
        board.push_san(san)

    result = bot.choose_move(board.fen())
    assert result["uci"] in {"b2b4", "c2c3"}
    assert result["source"] == "opening_book"


def test_labourdonnais_style_rewards_castling_and_development():
    """Проверяем, что атакующий фильтр Лабурдонне поощряет рокировку и вывод фигур в центр."""
    board = chess.Board("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")

    castle_bonus, _ = evaluate_labourdonnais_style_bonus(board, chess.Move.from_uci("e1g1"))
    nc3_bonus, _ = evaluate_labourdonnais_style_bonus(board, chess.Move.from_uci("b1c3"))
    passive_h3_bonus, _ = evaluate_labourdonnais_style_bonus(board, chess.Move.from_uci("h2h3"))

    assert castle_bonus > passive_h3_bonus
    assert nc3_bonus > passive_h3_bonus


def test_labourdonnais_middlegame_move_generation():
    """Проверяем генерацию хода Лабурдонне в миттельшпиле вне дебютной книги."""
    bot = LabourdonnaisBot(stockfish_path=None)
    board = chess.Board("r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 3 7")

    result = bot.choose_move(board.fen())
    assert chess.Move.from_uci(result["uci"]) in board.legal_moves
    assert result["source"] == "labourdonnais_style_engine"


@pytest.mark.asyncio
async def test_labourdonnais_api_move_endpoint():
    """Проверяем REST-эндпоинт /api/v1/bots/move для игры с Лабурдонне."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        bot_ids = [b["id"] for b in list_resp.json()["bots"]]
        assert "labourdonnais" in bot_ids

        start_key = normalize_fen_key(chess.Board())
        labourdonnais_start_moves = {item[0] for item in LABOURDONNAIS_OPENING_BOOK[start_key]}

        move_resp = await client.post(
            "/api/v1/bots/move",
            json={
                "bot_id": "labourdonnais",
                "fen": chess.STARTING_FEN,
            },
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["bot_id"] == "labourdonnais"
        assert data["uci"] in labourdonnais_start_moves
        assert data["source"] == "opening_book"
