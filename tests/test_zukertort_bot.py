# --- FILE: tests/test_zukertort_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.philidor import normalize_fen_key
from src.services.bots.zukertort import (
    ZUKERTORT_OPENING_BOOK,
    ZukertortBot,
    evaluate_zukertort_style_bonus,
)


def test_zukertort_opening_repertoire():
    """Проверяем, что Цукерторт делает ход из дебютной книги."""
    bot = ZukertortBot(stockfish_path=None)
    board = chess.Board()
    start_key = normalize_fen_key(board)
    expected_moves = {item[0] for item in ZUKERTORT_OPENING_BOOK[start_key]}

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_moves
    assert result["source"] == "opening_book"


def test_zukertort_style_rewards_development_and_castling():
    """Проверяем, что стилевой фильтр Цукерторта поощряет развитие лёгких фигур и рокировку."""
    board = chess.Board("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")

    castle_bonus, _ = evaluate_zukertort_style_bonus(board, chess.Move.from_uci("e1g1"))
    nc3_bonus, _ = evaluate_zukertort_style_bonus(board, chess.Move.from_uci("b1c3"))
    h3_bonus, _ = evaluate_zukertort_style_bonus(board, chess.Move.from_uci("h2h3"))

    assert castle_bonus > h3_bonus
    assert nc3_bonus > h3_bonus


@pytest.mark.asyncio
async def test_zukertort_api_move_endpoint():
    """Проверяем REST-эндпоинты /api/v1/bots/list и /api/v1/bots/move для игры с Цукертортом."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        bot_ids = [b["id"] for b in list_resp.json()["bots"]]
        assert "zukertort" in bot_ids

        move_resp = await client.post(
            "/api/v1/bots/move",
            json={"bot_id": "zukertort", "fen": chess.STARTING_FEN},
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["bot_id"] == "zukertort"
        assert data["source"] == "opening_book"
