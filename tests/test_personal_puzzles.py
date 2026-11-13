# --- FILE: tests/test_personal_puzzles.py ---
"""Задачи из партий игрока (таск 13.5): отбор решаемых моментов, повторение с интервалами, API, фоновый разбор."""

import datetime as dt
import json

import chess
import pytest
from sqlalchemy import func, select

from src.models.game import Game, GameStatus
from src.models.puzzle import PersonalPuzzle
from src.models.user import User
from src.services import personal_puzzles as service

API = "/api/v1/puzzles"
# 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# — чёрные зевают мат на 6-м полуходе (лучше 3...g6).
UCI = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]
PGN = '[Event "t"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'


def _analysis() -> str:
    moves = []
    for ply, uci in enumerate(UCI, start=1):
        bad = ply == 6
        moves.append({"ply": ply, "move_number": (ply + 1) // 2, "color": "white" if ply % 2 else "black",
                      "san": "", "uci": uci, "eval_cp": 0, "eval_display": "0", "best_move_uci": "g7g6" if bad else uci,
                      "cp_loss": 950 if bad else 0, "classification": "Blunder" if bad else "Best", "symbol": ""})
    return json.dumps({"format_version": 2, "engine": "t", "moves": moves})


@pytest.fixture
async def game(db_session, test_user_1, test_user_2):
    record = Game(white_player_id=test_user_2.id, black_player_id=test_user_1.id, status=GameStatus.COMPLETED,
                  base_time_ms=180000, increment_ms=0, is_rated=False, result="1-0", pgn=PGN,
                  analysis_json=_analysis())
    db_session.add(record)
    await db_session.commit()
    return record


@pytest.fixture
def engine(monkeypatch):
    """Подменённый движок: два лучших хода с заданным отрывом."""
    state = {"top": [("g7g6", 0), ("d8e7", -350)]}
    monkeypatch.setattr(service, "top_two", lambda board: state["top"])
    return state


async def test_blunder_becomes_a_personal_puzzle(db_session, game, engine, test_user_1):
    assert await service.extract_for_game(db_session, game.id) == 1
    puzzle = await db_session.scalar(select(PersonalPuzzle))
    assert puzzle.user_id == test_user_1.id and puzzle.ply == 6
    assert puzzle.solution == "g7g6" and puzzle.played == "g8f6" and puzzle.previous_move == "d1h5"
    assert chess.Board(puzzle.fen).turn == chess.BLACK
    # Повторный разбор ничего не дублирует.
    assert await service.extract_for_game(db_session, game.id) == 0
    assert await db_session.scalar(select(func.count()).select_from(PersonalPuzzle)) == 1


async def test_guessable_moments_are_skipped(db_session, game, engine):
    engine["top"] = [("g7g6", 0), ("d8e7", -120)]  # второй ход почти не хуже — это угадывание
    assert await service.extract_for_game(db_session, game.id) == 0


async def test_bots_and_unanalysed_games_give_nothing(db_session, game, engine, test_user_1):
    user = await db_session.get(User, test_user_1.id)
    user.is_bot = True
    await db_session.commit()
    assert await service.extract_for_game(db_session, game.id) == 0
    game.analysis_json = None
    await db_session.commit()
    assert await service.extract_for_game(db_session, game.id) == 0


def test_obvious_capture_is_not_a_puzzle():
    board = chess.Board("4k3/8/8/3n4/8/4N3/8/4K3 w - - 0 1")
    capture = chess.Move.from_uci("e3d5")
    assert service.obvious_capture(board, capture)
    assert not service.is_solvable(board, capture, [("e3d5", 300), ("e1d2", 0)])
    quiet = chess.Move.from_uci("e1d2")
    assert service.is_solvable(board, quiet, [("e1d2", 400), ("e3c4", 50)])
    assert not service.is_solvable(board, quiet, [("e1d2", 400)])  # единственный ход — решать нечего
    assert service.is_solvable(board, quiet, [("e1d2", 9_995), ("e3c4", 3_000)])  # мат против «просто выигрыша»


async def test_spaced_repetition(db_session, game, engine, test_user_1):
    await service.extract_for_game(db_session, game.id)
    user = await db_session.get(User, test_user_1.id)
    puzzle = await service.next_due(db_session, user)
    assert puzzle is not None

    wrong = await service.answer(db_session, user, puzzle.id, "d8e7")
    assert wrong["correct"] is False and wrong["solution"] == "g7g6" and wrong["played"] == "g8f6"
    due = dt.datetime.fromisoformat(wrong["next_due_at"])
    assert dt.timedelta(hours=23) < due - dt.datetime.now(dt.UTC) < dt.timedelta(hours=25)
    assert await service.next_due(db_session, user) is None  # до завтра — не показывается

    first = await service.answer(db_session, user, puzzle.id, "g7g6")
    assert first["correct"] and not first["done"] and first["solved_streak"] == 1
    assert dt.timedelta(days=2) < dt.datetime.fromisoformat(first["next_due_at"]) - dt.datetime.now(dt.UTC)
    second = await service.answer(db_session, user, puzzle.id, "g7g6")
    assert second["done"] and second["next_due_at"] is None
    summary = await service.summary(db_session, user)
    assert summary == {"due": 0, "active": 0, "mastered": 1, "next_due_at": None}


async def test_api(client, db_session, game, engine, token_user_1, token_user_2):
    await service.extract_for_game(db_session, game.id)
    auth = {"Authorization": f"Bearer {token_user_1}"}
    assert client.get(f"{API}/personal", headers=auth).json()["due"] == 1
    view = client.get(f"{API}/personal/next", headers=auth).json()
    assert view["color"] == "black" and view["previous_move"] == "d1h5" and "solution" not in view
    assert client.get(f"{API}/personal/game/{game.id}", headers=auth).json()["plies"] == [6]
    # Чужая задача недоступна, чужой разбор значков не показывает.
    other = {"Authorization": f"Bearer {token_user_2}"}
    assert client.post(f"{API}/personal/{view['id']}/answer", json={"move": "g7g6"}, headers=other).status_code == 404
    assert client.get(f"{API}/personal/game/{game.id}", headers=other).json()["plies"] == []
    illegal = client.post(f"{API}/personal/{view['id']}/answer", json={"move": "a1a8"}, headers=auth)
    assert illegal.status_code == 400
    body = client.post(f"{API}/personal/{view['id']}/answer", json={"move": "g7g6"}, headers=auth).json()
    assert body["correct"] is True
    assert client.get(f"{API}/personal/next", headers=auth).status_code == 404


def test_bot_game_is_analysed_in_the_background(client, token_user_1, no_celery_publish):
    saved = client.post("/api/v1/bots/save-game", headers={"Authorization": f"Bearer {token_user_1}"}, json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": ["f2f3", "e7e5", "g2g4", "d8h4"],
    })
    assert saved.status_code == 200
    import time

    for _ in range(50):
        if no_celery_publish:
            break
        time.sleep(0.02)
    assert saved.json()["game_id"] in no_celery_publish
