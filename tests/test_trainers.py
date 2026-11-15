# --- FILE: tests/test_trainers.py ---
"""Каркас тренажёров (таск 19.1): запись результата, личный рекорд уровня, рекорды и история для графика."""

API = "/api/v1/trainers"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def result(**extra) -> dict:
    return {"trainer": "quiet_path", "level": 2, "score": 80, "time_ms": 30_000, "mistakes": 1, **extra}


def test_records_per_level(client, token_user_1):
    first = client.post(f"{API}/results", headers=auth(token_user_1), json=result()).json()
    assert first == {"record": True, "best": 80}
    worse = client.post(f"{API}/results", headers=auth(token_user_1), json=result(score=50)).json()
    assert worse == {"record": False, "best": 80}
    other_level = client.post(f"{API}/results", headers=auth(token_user_1), json=result(level=3, score=10)).json()
    assert other_level["record"] is True
    records = client.get(f"{API}/records", headers=auth(token_user_1)).json()["records"]
    assert records == {"quiet_path": {"best": 80, "max_level": 3, "attempts": 3}}


def test_history_oldest_first(client, token_user_1):
    for score in (10, 20, 30):
        client.post(f"{API}/results", headers=auth(token_user_1), json=result(trainer="knight_route", score=score))
    assert client.post(f"{API}/results", headers=auth(token_user_1), json=result(trainer="tail")).status_code == 200
    history = client.get(f"{API}/history/knight_route", headers=auth(token_user_1)).json()["results"]
    assert [r["score"] for r in history] == [10, 20, 30]


def test_results_are_private(client, token_user_1, token_user_2):
    client.post(f"{API}/results", headers=auth(token_user_1), json=result())
    assert client.get(f"{API}/records", headers=auth(token_user_2)).json() == {"records": {}}


def test_validation(client, token_user_1):
    unknown = client.post(f"{API}/results", headers=auth(token_user_1), json=result(trainer="nope"))
    assert unknown.status_code == 404 and unknown.json()["detail"]["code"] == "trainer_not_found"
    assert client.post(f"{API}/results", headers=auth(token_user_1), json=result(level=0)).status_code == 422
    assert client.post(f"{API}/results", headers=auth(token_user_1), json=result(score=-1)).status_code == 422
    assert client.post(f"{API}/results", json=result()).status_code == 401
