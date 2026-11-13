# --- FILE: tests/test_puzzles_api.py ---
"""API решения задач (таск 13.2): решение не уходит клиенту, сервер проверяет каждый ход, рейтинг, подсказки."""

import datetime as dt

import pytest
from sqlalchemy import select

from src.models.puzzle import PuzzleAttempt
from src.services import puzzles as service
from src.services.puzzle_import import import_rows

API = "/api/v1/puzzles"


def _row(puzzle_id: str, fen: str, moves: str, tags: str, rating: int = 1500, popularity: int = 96) -> dict:
    return {"PuzzleId": puzzle_id, "FEN": fen, "Moves": moves, "Rating": str(rating), "RatingDeviation": "75",
            "Popularity": str(popularity), "NbPlays": "1000", "Themes": tags}


# Чёрные уводят ладью с последней горизонтали; Ld8+ Le8 Lxe8# — мат в 2.
BACK_RANK = _row("BR2", "4r1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1", "e8e2 d2d8 e2e8 d8e8", "mateIn2 backRankMate")
# Вилка конём: после ...Kh8 — Kf7+.
FORK = _row("FK1", "r2q2k1/ppp3pp/8/4N3/8/8/PPP2PPP/R2QK2R b KQ - 0 1", "g8h8 e5f7", "fork short", rating=1450)
# Мат в 1 двумя способами: в решении La8#, но Ld8# тоже мат.
TWO_MATES = _row("TM1", "6k1/5ppp/8/8/8/8/5PPP/R2R2K1 b - - 0 1", "g8h8 a1a8", "mateIn1", rating=900)


@pytest.fixture
async def puzzles(db_session):
    await import_rows(db_session, [BACK_RANK, FORK, TWO_MATES])


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _start(client, token, theme: str | None = None) -> dict:
    response = client.get(f"{API}/next", params={"theme": theme} if theme else None, headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def _move(client, token, puzzle_id: int, move: str):
    return client.post(f"{API}/{puzzle_id}/move", json={"move": move}, headers=_auth(token))


async def test_solution_is_not_sent_and_moves_are_checked_one_by_one(client, token_user_1, puzzles, db_session):
    puzzle = _start(client, token_user_1, "back_rank_mate")
    assert set(puzzle) == {"id", "fen", "first_move", "rating", "themes", "color", "solution_length"}
    assert puzzle["first_move"] == "e8e2" and puzzle["color"] == "white" and puzzle["solution_length"] == 2
    assert "back_rank_mate" in puzzle["themes"]

    first = _move(client, token_user_1, puzzle["id"], "d2d8").json()
    assert first == {"correct": True, "done": False, "reply": "e2e8", "solution": None, "result": None}
    last = _move(client, token_user_1, puzzle["id"], "d8e8").json()
    assert last["correct"] and last["done"]
    result = last["result"]
    assert result["solved"] and result["rating_after"] > result["rating_before"] == 1500
    assert result["streak"] == 1

    attempts = (await db_session.execute(select(PuzzleAttempt))).scalars().all()
    assert len(attempts) == 1 and attempts[0].solved
    # Задача закончена — ходы по ней больше не принимаются.
    assert _move(client, token_user_1, puzzle["id"], "d8e8").status_code == 409


async def test_wrong_move_ends_the_puzzle_and_shows_the_solution(client, token_user_1, puzzles):
    puzzle = _start(client, token_user_1, "fork_knight")
    body = _move(client, token_user_1, puzzle["id"], "e5d7").json()
    assert body["correct"] is False and body["done"] is True
    assert body["solution"] == ["e5f7"]
    assert body["result"]["solved"] is False and body["result"]["delta"] < 0
    assert body["result"]["streak"] == 0


async def test_any_mate_counts(client, token_user_1, puzzles):
    puzzle = _start(client, token_user_1, "mate_in_1")
    body = _move(client, token_user_1, puzzle["id"], "d1d8").json()
    assert body["correct"] and body["done"] and body["result"]["solved"]


async def test_illegal_and_foreign_moves(client, token_user_1, puzzles):
    puzzle = _start(client, token_user_1, "fork_knight")
    illegal = _move(client, token_user_1, puzzle["id"], "e5e7")
    assert illegal.status_code == 400 and illegal.json()["detail"]["code"] == "illegal_move"
    other = _move(client, token_user_1, puzzle["id"] + 999, "e5f7")
    assert other.status_code == 409 and other.json()["detail"]["code"] == "puzzle_not_active"


async def test_hints_reduce_the_gain(client, token_user_1, puzzles):
    puzzle = _start(client, token_user_1, "fork_knight")
    first = client.post(f"{API}/{puzzle['id']}/hint", headers=_auth(token_user_1)).json()
    assert first == {"from": "e5", "to": None, "hints_used": 1}
    second = client.post(f"{API}/{puzzle['id']}/hint", headers=_auth(token_user_1)).json()
    assert second == {"from": "e5", "to": "f7", "hints_used": 2}
    result = _move(client, token_user_1, puzzle["id"], "e5f7").json()["result"]
    assert result["solved"] and result["delta"] == 0
    # Решено с подсказкой — серия не растёт.
    assert result["streak"] == 0


def test_rating_formula():
    assert service.rating_delta(1500, 1500, 0, True, 0) == 20
    assert service.rating_delta(1500, 1500, 0, True, 1) == 10
    assert service.rating_delta(1500, 1500, 0, True, 2) == 0
    assert service.rating_delta(1500, 1500, 0, False, 2) == -20
    assert service.rating_delta(1500, 1500, 100, True, 0) == 10


async def test_give_up_shows_the_rest_of_the_solution(client, token_user_1, puzzles):
    puzzle = _start(client, token_user_1, "back_rank_mate")
    _move(client, token_user_1, puzzle["id"], "d2d8")
    body = client.post(f"{API}/{puzzle['id']}/give-up", headers=_auth(token_user_1)).json()
    assert body["solution"] == ["d8e8"] and body["result"]["solved"] is False


async def test_themes_and_repeats(client, token_user_1, puzzles):
    assert client.get(f"{API}/next", params={"theme": "nonsense"}, headers=_auth(token_user_1)).status_code == 400
    assert client.get(f"{API}/next", params={"theme": "lucena"}, headers=_auth(token_user_1)).status_code == 404
    seen = set()
    for _ in range(3):
        puzzle = _start(client, token_user_1)
        seen.add(puzzle["id"])
        client.post(f"{API}/{puzzle['id']}/give-up", headers=_auth(token_user_1))
    assert len(seen) == 3  # пока есть нерешавшиеся — повторов нет
    # Всё перерешано — задача всё равно выдаётся.
    assert _start(client, token_user_1)["id"] in seen


async def test_daily_puzzle_is_the_same_for_everyone(client, token_user_1, token_user_2, puzzles, db_session):
    first = client.get(f"{API}/daily", headers=_auth(token_user_1)).json()
    second = client.get(f"{API}/daily", headers=_auth(token_user_2)).json()
    assert first["id"] == second["id"] and first["daily"] is True
    today = dt.datetime.now(dt.UTC).date()
    other_days = {(await service.daily_puzzle(db_session, today + dt.timedelta(days=d))).id for d in range(10)}
    assert len(other_days) > 1


async def test_profile_and_auth(client, token_user_1, puzzles):
    assert client.get(f"{API}/next").status_code == 401
    puzzle = _start(client, token_user_1, "fork_knight")
    _move(client, token_user_1, puzzle["id"], "e5f7")
    profile = client.get(f"{API}/me", headers=_auth(token_user_1)).json()
    assert profile["games"] == 1 and profile["streak"] == 1 and profile["rating"] > 1500
    assert profile["history"][0]["puzzle_id"] == puzzle["id"] and profile["history"][0]["solved"] is True
