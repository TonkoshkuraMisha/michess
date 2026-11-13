# --- FILE: tests/test_theme_training.py ---
"""Тренировка по приёмам (таск 13.4): ступени задач, выдача по теме и разделу, прогресс 8 из 10, «без названия»."""

import pytest

from src.services import puzzles as service
from src.services.puzzle_import import import_rows, stage_for

API = "/api/v1/puzzles"
FORK_FEN = "r2q2k1/ppp3pp/8/4N3/8/8/PPP2PPP/R2QK2R b KQ - 0 1"


def _row(puzzle_id: str, rating: int, tags: str = "fork short", fen: str = FORK_FEN, moves: str = "g8h8 e5f7") -> dict:
    return {"PuzzleId": puzzle_id, "FEN": fen, "Moves": moves, "Rating": str(rating), "RatingDeviation": "75",
            "Popularity": "95", "NbPlays": "1000", "Themes": tags}


@pytest.fixture
async def fork_puzzles(db_session):
    service.reset_stage_counts()
    rows = [_row(f"S1_{i}", 900 + i) for i in range(12)] + [_row(f"S2_{i}", 1300 + i) for i in range(3)]
    rows.append(_row("PIN1", 1000, tags="pin short", fen="4k3/7p/2n5/8/8/8/4B3/4K3 b - - 0 1", moves="h7h6 e2b5"))
    await import_rows(db_session, rows)
    yield
    service.reset_stage_counts()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_stage_formula():
    assert stage_for(900, ["a", "b"]) == 1
    assert stage_for(1300, ["a", "b"]) == 2
    assert stage_for(1700, ["a", "b"]) == 3
    assert stage_for(2100, ["a", "b"]) == 4
    # Приём с продолжением (два хода решающего) — ещё знакомство; длинное решение поднимает ступень.
    assert stage_for(900, ["a"] * 4) == 1
    assert stage_for(900, ["a"] * 6) == 2
    assert stage_for(900, ["a"] * 8) == 3
    assert stage_for(900, ["a"] * 10) == 4


def _solve(client, token, clean: bool = True) -> dict:
    view = client.get(f"{API}/train", params={"theme": "fork_knight"}, headers=_auth(token)).json()
    if not clean:
        client.post(f"{API}/{view['id']}/hint", headers=_auth(token))
    body = client.post(f"{API}/{view['id']}/move", json={"move": "e5f7"}, headers=_auth(token)).json()
    return {"view": view, "training": body["result"]["training"]}


async def test_stage_advances_after_eight_clean_of_ten(client, token_user_1, fork_puzzles):
    first = _solve(client, token_user_1)
    assert first["view"]["stage"] == 1 and first["training"]["stage"] == 1 and first["training"]["recent"] == "1"
    _solve(client, token_user_1, clean=False)  # с подсказкой — не чисто
    _solve(client, token_user_1, clean=False)
    for _ in range(6):
        last = _solve(client, token_user_1)
    assert last["training"]["stage"] == 1 and last["training"]["recent"].count("1") == 7
    advanced = _solve(client, token_user_1)
    assert advanced["training"]["advanced"] and advanced["training"]["stage"] == 2
    # Следующая задача — уже со второй ступени.
    nxt = client.get(f"{API}/train", params={"theme": "fork_knight"}, headers=_auth(token_user_1)).json()
    assert nxt["stage"] == 2 and nxt["rating"] >= 1300


async def test_overview_lists_progress_and_availability(client, token_user_1, fork_puzzles):
    _solve(client, token_user_1)
    body = client.get(f"{API}/training", headers=_auth(token_user_1)).json()
    assert body["window"] == 10 and body["pass"] == 8 and len(body["themes"]) == 115
    fork_knight = next(t for t in body["themes"] if t["code"] == "fork_knight")
    assert fork_knight["stage"] == 1 and fork_knight["recent"] == "1" and fork_knight["solved"] == 1
    assert fork_knight["available"] == [12, 3, 0, 0] and fork_knight["ready"] is False
    lucena = next(t for t in body["themes"] if t["code"] == "lucena")
    assert lucena["available"] == [0, 0, 0, 0] and lucena["stage"] == 1


async def test_mixed_section_and_blind_mode(client, token_user_1, fork_puzzles):
    view = client.get(f"{API}/train", params={"section": "B", "blind": True}, headers=_auth(token_user_1)).json()
    assert view["themes"] == [] and view["stage"] is None
    body = client.post(f"{API}/{view['id']}/move", json={"move": "e2b5"}, headers=_auth(token_user_1)).json()
    # Тема показывается в итоге; прогресс отдельной темы смешанная подборка не трогает.
    assert "pin" in body["result"]["themes"] and body["result"]["training"] is None


@pytest.mark.parametrize("params, code", [
    ({}, "training_target_required"),
    ({"theme": "fork", "section": "A"}, "training_target_required"),
    ({"theme": "nope"}, "unknown_theme"),
    ({"section": "Z"}, "unknown_section"),
    ({"theme": "fork", "stage": 7}, "invalid_stage"),
])
async def test_bad_training_requests(client, token_user_1, fork_puzzles, params, code):
    response = client.get(f"{API}/train", params=params, headers=_auth(token_user_1))
    assert response.status_code == 400 and response.json()["detail"]["code"] == code


async def test_theme_without_puzzles_at_stage(client, token_user_1, fork_puzzles):
    response = client.get(f"{API}/train", params={"theme": "fork_knight", "stage": 4}, headers=_auth(token_user_1))
    assert response.status_code == 404 and response.json()["detail"]["code"] == "no_puzzles_available"


async def test_import_skips_nothing_here(db_session, fork_puzzles):
    from sqlalchemy import func, select

    from src.models.puzzle import Puzzle

    # Все тестовые задачи корректны: опечатка в позиции не должна молча оставлять раздел пустым.
    assert await db_session.scalar(select(func.count()).select_from(Puzzle)) == 16


async def test_demo_shows_solutions_without_an_attempt(client, token_user_1, fork_puzzles, db_session):
    from sqlalchemy import func, select

    from src.models.puzzle import PuzzleAttempt

    body = client.get(f"{API}/demo", params={"theme": "fork_knight"}, headers=_auth(token_user_1)).json()
    assert body["theme"] == "fork_knight" and len(body["examples"]) == 2
    assert body["examples"][0]["moves"] == ["g8h8", "e5f7"] and body["examples"][0]["color"] == "white"
    assert await db_session.scalar(select(func.count()).select_from(PuzzleAttempt)) == 0
    assert client.get(f"{API}/demo", params={"theme": "nope"}, headers=_auth(token_user_1)).status_code == 400
