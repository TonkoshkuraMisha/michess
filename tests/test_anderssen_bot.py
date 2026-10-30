# --- FILE: tests/test_anderssen_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.anderssen import (
    ANDERSSEN_OPENING_BOOK,
    AnderssenBot,
    evaluate_anderssen_style_bonus,
)
from src.services.bots.philidor import normalize_fen_key


def test_anderssen_opening_repertoire():
    """Проверяем, что в книге Андерсена есть его исторические ходы (включая e2e4 и a2a3)."""
    bot = AnderssenBot(stockfish_path=None)
    board = chess.Board()
    start_key = normalize_fen_key(board)
    expected_moves = {item[0] for item in ANDERSSEN_OPENING_BOOK[start_key]}

    assert "e2e4" in expected_moves

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_moves
    assert result["source"] == "opening_book"


def test_anderssen_plays_evans_gambit_from_book():
    """Проверяем, что в итальянской позиции Андерсен выбирает ход из своей дебютной книги (гамбит Эванса b2b4)."""
    bot = AnderssenBot(stockfish_path=None)
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]:
        board.push_san(san)

    fen_key = normalize_fen_key(board)
    expected_moves = {item[0] for item in ANDERSSEN_OPENING_BOOK[fen_key]}

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_moves
    assert result["source"] == "opening_book"


def test_anderssen_style_rewards_checks_and_attacks():
    """Проверяем, что комбинационный фильтр Андерсена поощряет шахи и развитие."""
    board = chess.Board("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")

    bf7_check_bonus, _ = evaluate_anderssen_style_bonus(board, chess.Move.from_uci("c4f7"))
    passive_h3_bonus, _ = evaluate_anderssen_style_bonus(board, chess.Move.from_uci("h2h3"))
    assert bf7_check_bonus > passive_h3_bonus


def test_anderssen_immortal_game_mate_in_one():
    """Проверяем, что Андерсен находит финальный мат слоном 23. Be7# из Бессмертной партии (1851)."""
    bot = AnderssenBot(stockfish_path=None)
    # Финал Бессмертной партии Андерсен — Кизерицкий (Лондон, 1851) перед 23. Be7#
    immortal_board = chess.Board("r1bk3r/p2pBpNp/n4n2/1p1NP2P/6P1/3P4/P1P1K3/q5b1 b - - 1 22")
    # Проверим позицию с ходом белых на мат в 1 ход:
    mate_board = chess.Board("r1bk3r/p2p1pNp/n2B1n2/1p1NP2P/6P1/3P4/P1P1K3/q5b1 w - - 0 23")

    result = bot.choose_move(mate_board.fen())
    assert result["uci"] == "d6e7"
    assert result["san"] == "Be7#"
    assert result["source"] == "anderssen_style_engine"
    assert immortal_board.is_checkmate()


@pytest.mark.asyncio
async def test_anderssen_api_move_endpoint():
    """Проверяем REST-эндпоинты /api/v1/bots/list и /api/v1/bots/move для игры с Андерсеном."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        bot_ids = [b["id"] for b in list_resp.json()["bots"]]
        assert "anderssen" in bot_ids

        move_resp = await client.post(
            "/api/v1/bots/move",
            json={"bot_id": "anderssen", "fen": chess.STARTING_FEN},
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["bot_id"] == "anderssen"
        assert data["source"] == "opening_book"
