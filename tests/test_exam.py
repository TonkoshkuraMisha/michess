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
    graded = await exam.grade(db_session, 1, "F",
                              [(pid, ["d1d8" if i < 3 else "d1d2"]) for i, pid in enumerate(mates["mates"])])
    assert (graded.correct, graded.total) == (3, 6) and graded.review[0]["solution_san"] == "Qd8#"
    with pytest.raises(DomainValueError) as wrong_section:
        await exam.grade(db_session, 1, "F", [(mates["fork"], ["d1d8"])])
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


# --- решение доигрывается до конца: очко за каждый верный ход -----------------------------------------------------

# Мат в 2 по последней горизонтали: после a7a6 белые 1. R2e8+ Rxe8 2. Rxe8#.
MATE2_FEN = "3r2k1/p4ppp/8/8/8/8/4RPPP/4R1K1 b - - 0 1"
MATE2_MOVES = "a7a6 e2e8 d8e8 e1e8"


@pytest.fixture
async def mate_in_two(db_session):
    puzzle = Puzzle(source="lichess", source_id="m2", fen=MATE2_FEN, moves=MATE2_MOVES, rating=1200)
    db_session.add(puzzle)
    await db_session.flush()
    db_session.add(PuzzleTheme(puzzle_id=puzzle.id, theme="back_rank_mate"))
    await db_session.commit()
    return puzzle


def test_play_follows_the_line_move_by_move():
    start = chess.Board(MATE2_FEN)
    start.push_uci("a7a6")
    line = MATE2_MOVES.split()[1:]
    first = exam.play(start, line, ["e2e8"])
    assert (first.correct, first.total, first.solved, first.failed, first.reply) == (1, 2, False, False, "d8e8")
    done = exam.play(start, line, ["e2e8", "e1e8"])
    assert (done.correct, done.solved, done.failed, done.reply) == (2, True, False, None) and done.share == 1.0
    # Ошибка на втором ходу: позиция закончена, очко за первый ход остаётся.
    slip = exam.play(start, line, ["e2e8", "g1h1"])
    assert (slip.correct, slip.solved, slip.failed) == (1, False, True) and slip.share == 0.5
    for bad in (["e2d2"], ["0000"], ["zzzz"], ["e1e9"]):
        wrong = exam.play(start, line, bad)
        assert (wrong.correct, wrong.failed, wrong.reply) == (0, True, None)
    assert exam.play(start, line, []).correct == 0 and not exam.play(start, line, []).failed
    # Лишние ходы после конца решения не считаются.
    assert exam.play(start, line, ["e2e8", "e1e8", "g1h1"]).correct == 2


def test_any_mate_is_a_full_solution():
    start = chess.Board("6k1/5ppp/8/8/8/8/8/RR4K1 w - - 0 1")
    other_mate = exam.play(start, ["a1a8"], ["b1b8"])
    assert other_mate.solved and other_mate.correct == other_mate.total == 1


def test_partial_solution_counts_between_miss_and_full_in_the_estimate():
    miss = exam.estimate([(1500, 0.0)] * 4)
    half = exam.estimate([(1500, 0.5)] * 4)
    full = exam.estimate([(1500, 1.0)] * 4)
    assert miss < half < full and half == 1500


async def test_move_endpoint_plays_the_combination_to_the_end(client, mate_in_two, token_user_1):
    headers = auth(token_user_1)
    url = f"{API}/F/move"
    assert client.post(url, json={"id": mate_in_two.id, "moves": ["e2e8"]}).status_code == 401
    first = client.post(url, json={"id": mate_in_two.id, "moves": ["e2e8"]}, headers=headers).json()
    assert first == {"correct": True, "reply": "d8e8", "done": False, "solved": False, "points": 1, "max_points": 2}
    last = client.post(url, json={"id": mate_in_two.id, "moves": ["e2e8", "e1e8"]}, headers=headers).json()
    assert last == {"correct": True, "reply": None, "done": True, "solved": True, "points": 2, "max_points": 2}
    wrong = client.post(url, json={"id": mate_in_two.id, "moves": ["e2d2"]}, headers=headers).json()
    assert wrong == {"correct": False, "reply": None, "done": True, "solved": False, "points": 0, "max_points": 2}
    # Задача не из этого раздела и неизвестный раздел.
    assert client.post(f"{API}/A/move", json={"id": mate_in_two.id, "moves": ["e2e8"]}, headers=headers).status_code == 400
    assert client.post(f"{API}/Z/move", json={"id": mate_in_two.id, "moves": ["e2e8"]}, headers=headers).status_code == 404


async def test_submit_scores_every_correct_move(client, mate_in_two, token_user_1):
    headers = auth(token_user_1)
    half = client.post(f"{API}/F/submit", headers=headers,
                       json={"answers": [{"id": mate_in_two.id, "moves": ["e2e8", "g1h1"]}]}).json()
    assert (half["correct"], half["total"], half["points"], half["max_points"]) == (0, 1, 1, 2)
    assert half["review"][0]["points"] == 1 and half["review"][0]["correct"] is False
    full = client.post(f"{API}/F/submit", headers=headers,
                       json={"answers": [{"id": mate_in_two.id, "moves": ["e2e8", "e1e8"]}]}).json()
    assert (full["correct"], full["points"], full["max_points"]) == (1, 2, 2) and full["estimate"] > half["estimate"]
    # Прежний формат «один ход» принимается: это первый ход решения.
    legacy = client.post(f"{API}/F/submit", headers=headers,
                         json={"answers": [{"id": mate_in_two.id, "move": "e2e8"}]}).json()
    assert (legacy["correct"], legacy["points"]) == (0, 1)
    skipped = client.post(f"{API}/F/submit", headers=headers, json={"answers": [{"id": mate_in_two.id, "moves": []}]}).json()
    assert (skipped["correct"], skipped["points"]) == (0, 0)
