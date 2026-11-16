"""Экзамены уровней Большого курса (таск 27.12): фиксированный набор позиций и тест через протокол экзамена 22.0."""

import chess
import pytest

from src.services import level_exam
from src.services.exam import estimate

TARGETS = (800, 1000, 1200, 1400, 1600, 1800)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_set_is_fixed_valid_and_covers_every_branch():
    data = level_exam.levels()
    assert list(data) == [f"level{n}" for n in range(6)]
    seen: set[str] = set()
    for n, item in enumerate(data.values()):
        assert item["target"] == TARGETS[n]
        questions = item["questions"]
        assert len(questions) == 12
        assert {q["branch"] for q in questions} == set(level_exam.BRANCHES)  # все ветви на каждом уровне
        for q in questions:
            board = chess.Board(q["fen"])
            assert board.is_valid() and not board.is_game_over()
            assert chess.Move.from_uci(q["answer"]) in board.legal_moves
            # Решение целиком: начинается с ответа, нечётной длины (последний ход — игрока), все ходы легальны.
            line = q["moves"]
            assert line[0] == q["answer"] and len(line) % 2 == 1
            for uci in line:
                board.push_uci(uci)
            assert level_exam.progress(q, line[::2]).solved
            assert abs(q["rating"] - item["target"]) <= 400  # около порога разряда уровня
            assert q["fen"] not in seen  # позиции не повторяются между уровнями
            seen.add(q["fen"])
        # Ответить на всё верно — сила не ниже порога, на половину — около него, ни на что — ниже.
        ratings = [q["rating"] for q in questions]
        assert estimate([(r, True) for r in ratings]) >= item["target"]
        assert estimate([(r, False) for r in ratings]) < item["target"]


def test_any_mate_counts_and_wrong_moves_do_not():
    item = {"fen": "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "answer": "a1a8"}
    assert level_exam.is_correct(item, "a1a8")
    assert not level_exam.is_correct(item, "a1a7")
    assert not level_exam.is_correct(item, "a1a9") and not level_exam.is_correct(item, "0000")


async def test_level_exam_through_the_exam_api(client, token_user_1):
    headers = _auth(token_user_1)
    summary = client.get("/api/v1/exam", headers=headers).json()
    assert summary["level_tests"] == [f"level{n}" for n in range(6)]
    body = client.get("/api/v1/exam/level2/questions", headers=headers).json()
    questions = body["questions"]
    assert [q["id"] for q in questions] == list(range(1, 13)) and questions[0]["branch"] in level_exam.BRANCHES
    answers = [{"id": q["id"], "moves": level_exam.question("level2", q["id"])["moves"][::2]} for q in questions]
    answers[0]["moves"] = ["0000"]
    graded = client.post("/api/v1/exam/level2/submit", json={"answers": answers}, headers=headers).json()
    assert graded["correct"] == 11 and graded["total"] == 12 and graded["estimate"] >= 1200
    assert graded["max_points"] == sum((len(level_exam.question("level2", q["id"])["moves"]) + 1) // 2 for q in questions)
    assert graded["points"] == graded["max_points"] - graded["review"][0]["max_points"]
    # Ход во время теста: верный первый ход — ответ соперника из решения (или конец, если решение в один ход).
    second = level_exam.question("level2", 2)
    step = client.post("/api/v1/exam/level2/move", json={"id": 2, "moves": [second["answer"]]}, headers=headers).json()
    assert step["correct"] is True and step["reply"] == (second["moves"][1] if len(second["moves"]) > 1 else None)
    assert sum(b["total"] for b in graded["branches"].values()) == 12
    assert client.get("/api/v1/exam", headers=headers).json()["results"]["level2"]["correct"] == 11
    bad = client.post("/api/v1/exam/level2/submit", json={"answers": [{"id": 99, "move": "e2e4"}]}, headers=headers)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "exam_question_unknown"


@pytest.mark.parametrize("section", ["level6", "levelx"])
def test_unknown_level(client, token_user_1, section):
    response = client.get(f"/api/v1/exam/{section}/questions", headers=_auth(token_user_1))
    assert response.status_code == 404
