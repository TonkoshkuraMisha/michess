# --- FILE: tests/test_mate_course.py ---
"""Курс матовых конструкций (таск 14.6): порядок, 10 задач по нарастанию сложности, задачи без рейтинга, проверка."""

import random

import pytest

from src.models.puzzle import Puzzle
from src.services import mate_course
from src.services.puzzle_import import import_rows
from src.services.themes import THEMES_BY_CODE

API = "/api/v1/puzzles/course/mates"


def _row(puzzle_id: str, rating: int, tags: str = "mateIn2 backRankMate") -> dict:
    return {"PuzzleId": puzzle_id, "FEN": "4r1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1", "Moves": "e8e2 d2d8 e2e8 d8e8",
            "Rating": str(rating), "RatingDeviation": "75", "Popularity": "96", "NbPlays": "1000", "Themes": tags}


@pytest.fixture
async def back_rank(db_session):
    # 19 задач одной конструкции: рейтинги 1000, 1100, …, 2800 — вперемешку.
    rows = [_row(f"BR{i}", 1000 + 100 * i) for i in range(19)]
    random.Random(1).shuffle(rows)
    await import_rows(db_session, rows)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_course_is_twenty_constructions_of_section_f():
    assert len(mate_course.COURSE) == 20 == len(set(mate_course.COURSE))
    assert all(THEMES_BY_CODE[code].section == "F" for code in mate_course.COURSE)
    assert mate_course.COURSE[0] == "back_rank_mate"


async def test_ten_tasks_from_easiest_to_hardest(db_session, back_rank):
    ids = await mate_course.task_ids(db_session, "back_rank_mate")
    assert len(ids) == mate_course.TASKS
    ratings = [(await db_session.get(Puzzle, pid)).rating for pid in ids]
    assert ratings == sorted(ratings) and ratings[0] == 1000 and ratings[-1] == 2800
    assert await mate_course.task_ids(db_session, "smothered_mate") == []


async def test_overview_counts_available_tasks(client, token_user_1, back_rank):
    body = client.get(API, headers=_auth(token_user_1)).json()
    assert body["tasks"] == 10 and body["exam_size"] == 10
    counts = {c["code"]: c["available"] for c in body["constructions"]}
    assert counts["back_rank_mate"] == 10 and counts["smothered_mate"] == 0
    assert [c["code"] for c in body["constructions"]] == list(mate_course.COURSE)


async def test_course_task_is_solved_without_rating_change(client, token_user_1, back_rank):
    task = client.get(f"{API}/back_rank_mate/0", headers=_auth(token_user_1)).json()
    assert task["course"] == "back_rank_mate" and task["index"] == 0 and task["rating"] == 1000
    client.post(f"/api/v1/puzzles/{task['id']}/move", json={"move": "d2d8"}, headers=_auth(token_user_1))
    last = client.post(f"/api/v1/puzzles/{task['id']}/move", json={"move": "d8e8"}, headers=_auth(token_user_1)).json()
    assert last["done"] and last["result"]["solved"]
    assert last["result"]["rating_after"] == last["result"]["rating_before"]


async def test_bad_theme_and_index(client, token_user_1, back_rank):
    assert client.get(f"{API}/fork/0", headers=_auth(token_user_1)).status_code == 400
    missing = client.get(f"{API}/back_rank_mate/10", headers=_auth(token_user_1))
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "no_puzzles_available"


async def test_exam_mixes_constructions_from_the_harder_half(db_session, back_rank):
    await import_rows(db_session, [_row(f"SM{i}", 1200 + 50 * i, "mateIn1 smotheredMate") for i in range(4)])
    plan = await mate_course.exam_plan(db_session, random.Random(3))
    assert {task["theme"] for task in plan} == {"back_rank_mate", "smothered_mate"}
    for task in plan:
        size = 10 if task["theme"] == "back_rank_mate" else 4
        assert size // 2 <= task["index"] < size


def test_course_requires_login(client):
    assert client.get(API).status_code == 401
