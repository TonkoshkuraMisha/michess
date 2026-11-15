# --- FILE: tests/test_tournament_career.py ---
"""Карьера турниров (таск 15.4): лестница, открытие этапов и скрытых приглашений, случайные соперники."""

import random
from datetime import UTC, datetime

import pytest

from src.models.tournament import Tournament, TournamentPlayer
from src.services import tournament_career as career
from src.services import tournament_rules as rules

API = "/api/v1/tournaments"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _finished(db, user, stage: str, place: int, withdrawn: bool = False) -> None:
    tournament = Tournament(owner_id=user.id, format="round_robin", size=4, status="finished", base_time_ms=300_000,
                            increment_ms=0, career_stage=stage, finished_at=datetime.now(UTC),
                            withdrawn_at=datetime.now(UTC) if withdrawn else None)
    db.add(tournament)
    await db.flush()
    db.add(TournamentPlayer(tournament_id=tournament.id, seat=1, kind="user", user_id=user.id, rating=1200, place=place))
    await db.commit()


def test_ladder_of_thirty_stages_with_growing_strength():
    assert len(career.STAGES) >= 30
    main = [s for s in career.STAGES if s.gate is None]
    assert [s.target for s in main] == sorted(s.target for s in main)
    for stage in career.STAGES:
        sizes = rules.ROUND_ROBIN_SIZES if stage.format == "round_robin" else rules.KNOCKOUT_SIZES
        assert stage.size in sizes
        opponents = career.stage_opponents(stage)
        assert len(opponents) == stage.size - 1 == len({(o.kind, o.id) for o in opponents})
        if stage.gate:
            assert stage.target > career.STAGES_BY_KEY[stage.gate].target


async def test_fresh_player_sees_first_stage_and_hidden_invitations(client, token_user_1):
    stages = {s["key"]: s for s in client.get(f"{API}/career", headers=auth(token_user_1)).json()["stages"]}
    assert stages["main-1"]["unlocked"] and not stages["main-2"]["unlocked"]
    secret = stages["invitational-1"]
    assert secret["hidden"] and "opponents" not in secret and "target" not in secret
    assert stages["main-2"]["opponents"] and stages["main-2"]["size"] == 4


@pytest.mark.parametrize(("place", "next_open", "invitation_open"), [(2, True, True), (3, False, True), (4, False, False)])
async def test_places_open_the_next_stage_and_the_invitation(db_session, test_user_1, place, next_open, invitation_open):
    await _finished(db_session, test_user_1, "main-4", place)
    best = await career.best_places(db_session, test_user_1)
    assert career.unlocked(career.STAGES_BY_KEY["main-5"], best) is next_open
    assert career.unlocked(career.STAGES_BY_KEY["invitational-1"], best) is invitation_open


async def test_withdrawn_tournament_does_not_count(db_session, test_user_1):
    await _finished(db_session, test_user_1, "main-1", 1, withdrawn=True)
    assert await career.best_places(db_session, test_user_1) == {}


async def test_start_stage(client, token_user_1):
    locked = client.post(f"{API}/career/main-2", headers=auth(token_user_1))
    assert locked.status_code == 403 and locked.json()["detail"]["code"] == "career_stage_locked"
    assert client.post(f"{API}/career/nope", headers=auth(token_user_1)).status_code == 404
    started = client.post(f"{API}/career/main-1", headers=auth(token_user_1))
    assert started.status_code == 201
    body = started.json()
    assert body["career_stage"] == "main-1" and body["size"] == 4
    assert {p["bot_key"] for p in body["players"] if p["kind"] != "user"} == {
        f"archetype:{o.id}" for o in career.stage_opponents(career.STAGES_BY_KEY["main-1"])}
    again = client.post(f"{API}/career/main-1", headers=auth(token_user_1))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "tournament_active_exists"
    listed = client.get(API, headers=auth(token_user_1)).json()
    assert listed[0]["career_stage"] == "main-1"


def test_random_opponents_come_from_the_range():
    rng = random.Random(5)
    for mode, target in (("my_level", 1500), ("stronger", 1700), ("weaker", 1300)):
        chosen = career.random_opponents(1500, mode, 3, rng)
        assert len(set(chosen)) == 3
        # Выбор — из шести ближайших по силе к цели режима.
        assert set(chosen) <= set(career.nearest(target, 6)), mode


async def test_create_with_random_opponents(client, token_user_1):
    body = {"format": "round_robin", "size": 6, "random": "stronger", "base_time_ms": 300_000, "increment_ms": 0}
    response = client.post(API, headers=auth(token_user_1), json=body)
    assert response.status_code == 201
    assert len([p for p in response.json()["players"] if p["kind"] != "user"]) == 5


async def test_create_without_opponents_is_rejected(client, token_user_1):
    body = {"format": "round_robin", "size": 4, "base_time_ms": 300_000, "increment_ms": 0}
    response = client.post(API, headers=auth(token_user_1), json=body)
    assert response.status_code == 400 and response.json()["detail"]["code"] == "tournament_participants_count"
