"""Диагностический экзамен (таск 22.0): вопросы по разделу от лёгкого к трудному, проверка ответа, оценка, уровни."""

import random

import chess
import pytest

from src.core.errors import DomainValueError
from src.models.puzzle import Puzzle, PuzzleTheme
from src.services import exam

API = "/api/v1/exam"
# Мат в 1: после хода чёрных a7a6 белые ставят мат Qd8# по последней горизонтали.
MATE_FEN = "6k1/p4ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 1"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def mates(db_session):
    ids = []
    for index, rating in enumerate((650, 900, 1300, 1700, 2100, 2350)):
        puzzle = Puzzle(source="lichess", source_id=f"m{index}", fen=MATE_FEN, moves="a7a6 d1d8", rating=rating)
        db_session.add(puzzle)
        await db_session.flush()
        db_session.add(PuzzleTheme(puzzle_id=puzzle.id, theme="back_rank_mate"))
        ids.append(puzzle.id)
    other = Puzzle(source="lichess", source_id="fork1", fen=MATE_FEN, moves="a7a6 d1d8", rating=1500)
    db_session.add(other)
    await db_session.flush()
    db_session.add(PuzzleTheme(puzzle_id=other.id, theme="fork"))
    await db_session.commit()
    return {"mates": ids, "fork": other.id}


def test_targets_levels_and_estimate():
    assert exam.targets(10) == [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400]
    assert [exam.level(r) for r in (900, 1100, 1350, 1500, 1700, 1900, 2300)] == [
        "novice", "fourth", "third", "second", "first", "candidate", "master"]
    weak = exam.estimate([(r, r < 1000) for r in exam.targets(10)])
    strong = exam.estimate([(r, r < 2000) for r in exam.targets(10)])
    assert weak < 1300 < strong and exam.estimate([]) == 1500


async def test_questions_and_grading(db_session, mates):
    questions = await exam.build(db_session, "F", random.Random(1))
    assert [q["id"] for q in questions] == mates["mates"]  # все шесть, по возрастанию рейтинга
    assert questions[0]["color"] == "white" and questions[0]["previous_move"] == "a7a6"
    assert chess.Board(questions[0]["fen"]).turn == chess.WHITE
    with pytest.raises(DomainValueError):
        await exam.build(db_session, "Z")
    graded = await exam.grade(db_session, 1, "F", [(pid, "d1d8" if i < 3 else "d1d2") for i, pid in enumerate(mates["mates"])])
    assert (graded.correct, graded.total) == (3, 6) and graded.review[0]["solution_san"] == "Qd8#"
    with pytest.raises(DomainValueError) as wrong_section:
        await exam.grade(db_session, 1, "F", [(mates["fork"], "d1d8")])
    assert wrong_section.value.code == "exam_question_unknown"


async def test_api_flow(client, mates, token_user_1):
    assert client.get(f"{API}/F/questions").status_code == 401
    got = client.get(f"{API}/F/questions", headers=auth(token_user_1)).json()
    assert len(got["questions"]) == 6
    answers = [{"id": q["id"], "move": "d1d8"} for q in got["questions"]]
    result = client.post(f"{API}/F/submit", headers=auth(token_user_1), json={"answers": answers}).json()
    assert result["correct"] == 6 and result["level"] in ("candidate", "master")
    summary = client.get(API, headers=auth(token_user_1)).json()
    assert summary["tests"][0] == "F" and summary["tests"][-1] == "endgame" and summary["passed"] == 1
    assert summary["results"]["F"]["correct"] == 6 and summary["overall"] == result["estimate"]
    empty = client.get(f"{API}/endgame/questions", headers=auth(token_user_1))
    assert empty.status_code == 404 and empty.json()["detail"]["code"] == "exam_section_empty"
    assert client.get(f"{API}/X/questions", headers=auth(token_user_1)).status_code == 404
