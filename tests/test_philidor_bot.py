# --- FILE: tests/test_philidor_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.philidor import (
    PHILIDOR_OPENING_BOOK,
    PhilidorBot,
    evaluate_philidor_style_bonus,
    normalize_fen_key,
)


def test_philidor_plays_philidor_defense_as_black():
    """Проверяем, что на 1. e4 e5 2. Nf3 Филидор всегда отвечает своей защитой 2... d6."""
    bot = PhilidorBot(stockfish_path=None)
    board = chess.Board()
    for san in ["e4", "e5", "Nf3"]:
        board.push_san(san)

    result = bot.choose_move(board.fen())
    assert result["uci"] == "d7d6"
    assert result["source"] == "opening_book"


def test_philidor_dislikes_blocking_c_pawn_with_knight():
    """Проверяем, что стилевой фильтр штрафует ход Nc3 при пешке на c2 и поощряет c2-c3."""
    board = chess.Board()
    for san in ["e4", "e5", "Bc4", "Bc5"]:
        board.push_san(san)

    c3_bonus, _ = evaluate_philidor_style_bonus(board, chess.Move.from_uci("c2c3"))
    nc3_bonus, _ = evaluate_philidor_style_bonus(board, chess.Move.from_uci("b1c3"))

    assert c3_bonus > 0
    assert nc3_bonus < 0
    assert c3_bonus > nc3_bonus


def test_philidor_middlegame_move_generation():
    """Проверяем генерацию хода Филидора в миттельшпиле вне дебютной книги."""
    bot = PhilidorBot(stockfish_path=None)
    board = chess.Board("r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R w KQkq - 1 6")

    result = bot.choose_move(board.fen())
    assert chess.Move.from_uci(result["uci"]) in board.legal_moves
    assert result["source"] == "philidor_style_engine_deep"


@pytest.mark.asyncio
async def test_philidor_api_move_endpoint():
    """Проверяем REST-эндпоинт /api/v1/bots/move для игры с Филидором."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        bot_ids = [b["id"] for b in list_resp.json()["bots"]]
        assert "philidor" in bot_ids

        start_key = normalize_fen_key(chess.Board())
        philidor_start_moves = {item[0] for item in PHILIDOR_OPENING_BOOK[start_key]}

        move_resp = await client.post(
            "/api/v1/bots/move",
            json={
                "bot_id": "philidor",
                "fen": chess.STARTING_FEN,
            },
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["bot_id"] == "philidor"
        assert data["uci"] in philidor_start_moves
        assert data["source"] == "opening_book"
