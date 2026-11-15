"""
Соперники для новичков и характеры (таск 21.4): привычки и дебютный характер как правила стиля и линии, отношение к
ничьей (выбор хода при равенстве и ответ на предложение), проходные пешки, новые архетипы 300–1200 вне лестницы.
"""

import chess
import pytest
from pydantic import ValidationError

from src.services import move_check
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_ID, BEGINNER_IDS, LADDER_ARCHETYPES
from src.services.bots.personality import (
    BotPersonalityConfig,
    PersonalityBot,
    accepts_draw,
    build_style,
    favorite_moves,
    strength_for,
    style_lines,
)

API = "/api/v1/bots"


def bonus(config: BotPersonalityConfig, board: chess.Board, uci: str) -> float:
    return build_style(config).evaluate(board, chess.Move.from_uci(uci))[0]


def test_defaults_change_nothing():
    plain = BotPersonalityConfig()
    assert (plain.habits, plain.opening_style, plain.draw_attitude, plain.passed_pawns) == ([], "normal", 0, 100)
    assert favorite_moves(plain) == {}
    # Сила 600+ считается как раньше (параметры поиска от 600), ниже — только больше ошибок.
    assert strength_for(600).depth == strength_for(300).depth and strength_for(300).error_rate == 0.57
    assert strength_for(1500).error_rate == 0.0
    with pytest.raises(ValidationError):
        BotPersonalityConfig(habits=["flies"])
    with pytest.raises(ValidationError):
        BotPersonalityConfig(target_elo=299)


def test_habits_shift_move_preferences():
    board = chess.Board("rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3")
    grabber = BotPersonalityConfig(habits=["pawn_grabber"])
    assert bonus(grabber, board, "e4d5") > bonus(BotPersonalityConfig(), board, "e4d5")
    queen = BotPersonalityConfig(habits=["early_queen"])
    assert bonus(queen, board, "d1e2") - bonus(BotPersonalityConfig(), board, "d1e2") >= 80
    knights = BotPersonalityConfig(habits=["knight_lover"])
    assert bonus(knights, board, "b1c3") > bonus(knights, board, "f1c4")
    castle_board = chess.Board("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5")
    assert bonus(BotPersonalityConfig(habits=["no_castling"]), castle_board, "e1g1") < -100
    careless = BotPersonalityConfig(habits=["hangs_pieces"])
    # Взятие — не «зевок»; слон на d5 под ударом коня f6 — «оставить под боем».
    assert bonus(careless, castle_board, "c4f7") == bonus(BotPersonalityConfig(), castle_board, "c4f7")
    assert bonus(careless, castle_board, "c4d5") - bonus(BotPersonalityConfig(), castle_board, "c4d5") == 70


def test_passed_pawns_slider():
    board = chess.Board("8/5k2/8/3P4/8/8/5K2/8 w - - 0 1")
    eager = BotPersonalityConfig(passed_pawns=200)
    assert bonus(eager, board, "d5d6") - bonus(BotPersonalityConfig(), board, "d5d6") == 35
    assert bonus(BotPersonalityConfig(passed_pawns=0), board, "d5d6") < bonus(BotPersonalityConfig(), board, "d5d6")


def test_opening_characters_follow_table_lines():
    victim, trapper = style_lines("trap_victim"), style_lines("trapper")
    assert victim and len(victim) == len(trapper)
    assert all(v[0] != t[0] for v, t in zip(victim, trapper, strict=True))  # стороны ловушки — разные
    assert all("Gambit" in name and "Declined" not in name for _, _, name in style_lines("gambit"))
    bot = PersonalityBot(BotPersonalityConfig(opening_style="offbeat"))
    move, comment = bot._book_move(chess.Board())
    assert comment == {"key": "personality.openingHabit", "params": {}}  # название линии не выдаётся
    assert move.uci() not in ("e2e4", "d2d4", "c2c4", "g1f3")


def test_draw_attitude():
    assert accepts_draw(BotPersonalityConfig(), 20) and not accepts_draw(BotPersonalityConfig(), 60)
    assert accepts_draw(BotPersonalityConfig(draw_attitude=100), 190)
    assert not accepts_draw(BotPersonalityConfig(draw_attitude=-100), -900)
    # При равенстве миролюбивый охотнее меняет фигуры, непримиримый — избегает размена.
    board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4")
    capture = chess.Move.from_uci("f3e5")
    scores = {capture: 0.0, chess.Move.from_uci("f1c4"): 10.0}
    peace = PersonalityBot(BotPersonalityConfig(draw_attitude=100))._draw_attitude(board, scores)
    assert peace[capture] == 0.0  # e5 — пешка: размен фигуры не засчитывается
    trade_board = chess.Board("r1bqkb1r/pppp1ppp/2n5/4p3/3nP3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4")
    trade = chess.Move.from_uci("f3d4")
    peace = PersonalityBot(BotPersonalityConfig(draw_attitude=100))._draw_attitude(trade_board, {trade: 0.0})
    fight = PersonalityBot(BotPersonalityConfig(draw_attitude=-100))._draw_attitude(trade_board, {trade: 0.0})
    assert peace[trade] == 40.0 and fight[trade] == -40.0


def test_beginner_archetypes():
    beginners = [a for a in ARCHETYPES if a.id in BEGINNER_IDS]
    assert len(beginners) == 12 and all(300 <= a.config.target_elo <= 1200 for a in beginners)
    assert not any(a.id in BEGINNER_IDS for a in LADDER_ARCHETYPES)  # прогресс лестницы не сдвигается
    assert ARCHETYPES_BY_ID["trap_victim"].config.opening_style == "trap_victim"


def test_draw_offer_endpoint(client, monkeypatch):
    async def even(board):
        return move_check.PositionEval(cp_white=10, mate=None, best_uci=None)

    monkeypatch.setattr(move_check, "evaluate_cached", even)
    late = "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 12"
    body = {"fen": late, "bot_id": "custom", "bot_color": "black", "config": {"draw_attitude": 0}}
    assert client.post(f"{API}/draw-offer", json=body).json()["accepted"] is True
    stubborn = {**body, "config": {"draw_attitude": -100}}
    reply = client.post(f"{API}/draw-offer", json=stubborn).json()
    assert reply == {"accepted": False, "comment": {"key": "personality.drawDeclined", "params": {}}}
    early = {**body, "fen": chess.STARTING_FEN}
    assert client.post(f"{API}/draw-offer", json=early).json()["comment"]["key"] == "personality.drawTooEarly"
    assert client.post(f"{API}/draw-offer", json={**body, "bot_id": "nobody"}).status_code == 404
    morphy = {"fen": late, "bot_id": "morphy", "bot_color": "white"}
    assert client.post(f"{API}/draw-offer", json=morphy).json()["accepted"] is False  # романтик: −40


def test_agreement_saved_as_draw(client, token_user_1):
    moves = ["e2e4", "e7e5", "g1f3", "b8c6"]
    saved = client.post(f"{API}/save-game", headers={"Authorization": f"Bearer {token_user_1}"}, json={
        "bot_id": "philidor", "player_color": "white", "result": "1-0", "termination": "agreement", "moves_uci": moves,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["result"] == "1/2-1/2"
