# --- FILE: tests/test_morphy_bot.py ---

import chess
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.services.bots.morphy import (
    MORPHY_OPENING_BOOK,
    MorphyBot,
    evaluate_morphy_style_bonus,
)
from src.services.bots.philidor import normalize_fen_key


def test_morphy_opening_repertoire_branches():
    """Проверяем, что в дебютной книге Морфи есть стартовые ходы и они выбираются из книги."""
    bot = MorphyBot(stockfish_path=None)
    board = chess.Board()
    start_key = normalize_fen_key(board)
    expected_book_moves = {item[0] for item in MORPHY_OPENING_BOOK[start_key]}

    assert "e2e4" in expected_book_moves

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_book_moves
    assert result["source"] == "opening_book"


def test_morphy_plays_active_openings_from_book():
    """Проверяем, что в итальянской позиции Морфи выбирает ход из своей дебютной книги."""
    bot = MorphyBot(stockfish_path=None)
    board = chess.Board()
    for san in ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]:
        board.push_san(san)

    fen_key = normalize_fen_key(board)
    expected_moves = {item[0] for item in MORPHY_OPENING_BOOK[fen_key]}

    result = bot.choose_move(board.fen())
    assert result["uci"] in expected_moves
    assert result["source"] == "opening_book"


def test_morphy_style_rewards_castling_and_open_files():
    """Проверяем, что стилевой фильтр Морфи поощряет рокировку, развитие и выход ладьи на центральную линию."""
    board = chess.Board("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")

    castle_bonus, _ = evaluate_morphy_style_bonus(board, chess.Move.from_uci("e1g1"))
    nc3_bonus, _ = evaluate_morphy_style_bonus(board, chess.Move.from_uci("b1c3"))
    passive_h3_bonus, _ = evaluate_morphy_style_bonus(board, chess.Move.from_uci("h2h3"))

    assert castle_bonus > passive_h3_bonus
    assert nc3_bonus > passive_h3_bonus


def test_morphy_middlegame_move_generation():
    """Проверяем генерацию хода Морфи в миттельшпиле вне дебютной книги (и мат в 1 ход 17. Rd8# из Оперной партии)."""
    bot = MorphyBot(stockfish_path=None)
    # Точный финал Оперной партии Морфи (Париж, 1858) после 16. Qb8+! Nxb8 — ход 17. Rd8#
    opera_board = chess.Board("1n2kb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4 w k - 0 17")

    result = bot.choose_move(opera_board.fen())
    assert result["uci"] == "d1d8"
    assert result["san"] == "Rd8#"
    assert result["source"] == "morphy_style_engine"


@pytest.mark.asyncio
async def test_morphy_api_move_endpoint():
    """Проверяем REST-эндпоинты /api/v1/bots/list и /api/v1/bots/move для игры с Полом Морфи."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        list_resp = await client.get("/api/v1/bots/list")
        assert list_resp.status_code == 200
        bot_ids = [b["id"] for b in list_resp.json()["bots"]]
        assert "morphy" in bot_ids

        start_key = normalize_fen_key(chess.Board())
        morphy_start_moves = {item[0] for item in MORPHY_OPENING_BOOK[start_key]}

        move_resp = await client.post(
            "/api/v1/bots/move",
            json={
                "bot_id": "morphy",
                "fen": chess.STARTING_FEN,
            },
        )
        assert move_resp.status_code == 200
        data = move_resp.json()
        assert data["bot_id"] == "morphy"
        assert data["uci"] in morphy_start_moves
        assert data["source"] == "opening_book"
