# --- FILE: tests/test_philidor_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.philidor import PhilidorBot, evaluate_philidor_style_bonus


def test_philidor_plays_philidor_defense_as_black():
    """Проверяем, что на 1. e4 e5 2. Nf3 Филидор всегда отвечает своей защитой 2... d6."""
    bot = PhilidorBot(stockfish_path=None)
    board = chess.Board()
    for san in ["e4", "e5", "Nf3"]:
        board.push_san(san)

    res = bot.choose_move(board.fen())
    assert res["uci"] == "d7d6"
    assert res["san"] == "d6"
    assert res["source"] == "opening_book"


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
    """Проверяем, что вне дебютной книги бот делает легальный ход и не зевает ферзя."""
    bot = PhilidorBot(stockfish_path=None)
    fen = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 1 7"
    res = bot.choose_move(fen)

    board = chess.Board(fen)
    move = chess.Move.from_uci(res["uci"])
    assert move in board.legal_moves
    assert "comment" in res


@pytest.mark.asyncio
async def test_bots_api_move_endpoint():
    """Проверяем REST-эндпоинт /api/v1/bots/move для игры с Филидором."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Проверяем список ботов
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        assert list_resp.json()["bots"][0]["id"] == "philidor"

        # 2. Запрашиваем первый ход Филидора за белых из начальной позиции
        move_resp = await client.post(
            "/api/v1/bots/move",
            json={
                "bot_id": "philidor",
                "fen": chess.STARTING_FEN,
            },
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["uci"] == "e2e4"
        assert data["san"] == "e4"
        assert len(data["comment"]) > 0
