# --- FILE: tests/test_learn_progress.py ---
"""Прогресс уроков школы (таск 14.1): только растёт, лучший результат экзамена, чужой прогресс не виден."""

import pytest

API = "/api/v1/learn/progress"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def put(client, token, lesson="tactics-fork", **body):
    payload = {"step": 0, "steps_total": 8, **body}
    return client.put(f"{API}/{lesson}", headers=auth(token), json=payload)


def test_progress_round_trip(client, token_user_1):
    assert client.get(API, headers=auth(token_user_1)).json() == []

    saved = put(client, token_user_1, step=3)
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "lesson_id": "tactics-fork", "step": 3, "steps_total": 8, "completed": False,
        "exam_score": None, "exam_total": None,
    }
    assert [p["lesson_id"] for p in client.get(API, headers=auth(token_user_1)).json()] == ["tactics-fork"]


def test_step_never_goes_back_and_completion_sticks(client, token_user_1):
    put(client, token_user_1, step=6, completed=True, exam_score=2, exam_total=3)
    again = put(client, token_user_1, step=1).json()  # повторное прохождение с начала
    assert again["step"] == 6 and again["completed"] is True and again["exam_score"] == 2


def test_best_exam_score_is_kept_until_the_exam_changes(client, token_user_1):
    put(client, token_user_1, step=7, completed=True, exam_score=3, exam_total=3)
    assert put(client, token_user_1, step=7, exam_score=1, exam_total=3).json()["exam_score"] == 3
    # Экзамен переписали (стало 4 вопроса) — старый результат к нему не относится.
    changed = put(client, token_user_1, step=7, exam_score=1, exam_total=4).json()
    assert (changed["exam_score"], changed["exam_total"]) == (1, 4)


def test_shorter_lesson_clamps_the_step(client, token_user_1):
    put(client, token_user_1, step=7, steps_total=8)
    assert put(client, token_user_1, step=2, steps_total=5).json()["step"] == 4


def test_progress_is_per_player(client, token_user_1, token_user_2):
    put(client, token_user_1, step=5)
    assert client.get(API, headers=auth(token_user_2)).json() == []
    assert put(client, token_user_2, step=1).json()["step"] == 1


def test_requires_login(client):
    assert client.get(API).status_code == 401
    assert client.put(f"{API}/tactics-fork", json={"step": 0, "steps_total": 8}).status_code == 401


@pytest.mark.parametrize("lesson, body", [
    ("Bad_ID", {}),  # не слаг
    ("x", {}),  # слишком короткий
    ("tactics-fork", {"step": 8}),  # шаг за пределами урока
    ("tactics-fork", {"exam_score": 2}),  # счёт без числа вопросов
    ("tactics-fork", {"exam_score": 4, "exam_total": 3}),  # больше, чем вопросов
    ("tactics-fork", {"steps_total": 500}),
])
def test_validation(client, token_user_1, lesson, body):
    assert put(client, token_user_1, lesson=lesson, **body).status_code == 422
