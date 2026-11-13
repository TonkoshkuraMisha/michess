# --- FILE: tests/test_tournaments.py ---
"""Турниры (таск 15.1): создание с посевом, проверки, ход кругового турнира и турнира на выбывание до мест."""

import pytest
from sqlalchemy import select

from src.models.tournament import Tournament, TournamentGame
from src.services import tournaments as service

API = "/api/v1/tournaments"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def body(fmt="round_robin", size=4, participants=None, **extra):
    participants = participants or [{"kind": "bot", "id": b} for b in ("morphy", "philidor", "staunton")][: size - 1]
    return {"format": fmt, "size": size, "participants": participants, "base_time_ms": 300_000, **extra}


def eight():
    return [{"kind": "bot", "id": b} for b in ("morphy", "philidor", "staunton", "anderssen", "paulsen", "zukertort")] \
        + [{"kind": "archetype", "id": "rusher"}]


async def play(db, tournament_id: int, outcome) -> None:
    """Играет все текущие партии турнира: outcome(game) → результат."""
    while True:
        tournament = await db.get(Tournament, tournament_id)
        await db.refresh(tournament)
        pending = [g for g in await service.games_of(db, tournament_id) if g.result is None]
        if not pending or tournament.status != "active":
            return
        await service.record_result(db, tournament, pending[0], outcome(pending[0]))


# --- создание -------------------------------------------------------------------------------------

def test_round_robin_is_seeded_and_scheduled(client, token_user_1):
    created = client.post(API, headers=auth(token_user_1), json=body())
    assert created.status_code == 201, created.text
    t = created.json()
    assert (t["format"], t["size"], t["status"], t["current_round"]) == ("round_robin", 4, "active", 1)
    ratings = [p["rating"] for p in t["players"]]
    assert ratings == sorted(ratings, reverse=True)  # посев по рейтингу
    me = next(p for p in t["players"] if p["kind"] == "user")
    assert t["my_seat"] == me["seat"] == 4  # игрок с 1200 слабее ботов
    assert len(t["games"]) == 6 and {g["round"] for g in t["games"]} == {1, 2, 3}
    assert [(g["white_seat"], g["black_seat"]) for g in t["games"] if g["round"] == 1] == [(1, 4), (2, 3)]
    assert all(s["points"] == 0 for s in t["standings"])


def test_knockout_first_round_by_seeding(client, token_user_1):
    t = client.post(API, headers=auth(token_user_1), json=body("knockout", 8, eight())).json()
    assert [(g["white_seat"], g["black_seat"]) for g in t["games"]] == [(1, 8), (4, 5), (2, 7), (3, 6)]
    assert {g["stage"] for g in t["games"]} == {"main"}


def rivals(*items):
    return [{"kind": kind, "id": ident} for kind, ident in items]


B = "bot"


@pytest.mark.parametrize("payload, code", [
    (body("round_robin", 5, rivals((B, "morphy"), (B, "philidor"), (B, "staunton"), (B, "paulsen"))),
     "tournament_size_invalid"),
    (body("knockout", 6, eight()[:5]), "tournament_size_invalid"),
    (body("round_robin", 6, rivals((B, "morphy"), (B, "philidor"), (B, "staunton"))), "tournament_participants_count"),
    (body(participants=rivals((B, "morphy"), (B, "morphy"), (B, "philidor"))), "tournament_participant_duplicate"),
    (body(participants=rivals((B, "kasparov"), (B, "morphy"), (B, "philidor"))), "tournament_participant_unknown"),
    (body(participants=rivals(("archetype", "nobody"), (B, "morphy"), (B, "philidor"))), "tournament_participant_unknown"),
    (body(participants=rivals(("personality", 999), (B, "morphy"), (B, "philidor"))), "tournament_participant_unknown"),
])
def test_creation_is_validated(client, token_user_1, payload, code):
    response = client.post(API, headers=auth(token_user_1), json=payload)
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == code


def test_one_active_tournament_per_player(client, token_user_1):
    assert client.post(API, headers=auth(token_user_1), json=body()).status_code == 201
    second = client.post(API, headers=auth(token_user_1), json=body())
    assert second.status_code == 409 and second.json()["detail"]["code"] == "tournament_active_exists"


def test_personality_participant_is_copied(client, token_user_1):
    pid = client.post("/api/v1/bots/personalities", headers=auth(token_user_1),
                      json={"name": "Gambiteer", "config": {"aggression": 80, "target_elo": 1700}}).json()["id"]
    t = client.post(API, headers=auth(token_user_1), json=body(participants=[
        {"kind": "personality", "id": pid}, {"kind": "bot", "id": "morphy"}, {"kind": "archetype", "id": "rusher"},
    ])).json()
    personality = next(p for p in t["players"] if p["kind"] == "personality")
    assert personality["personality_name"] == "Gambiteer" and personality["rating"] == 1700
    # Удаление персоналии не меняет турнир.
    assert client.delete(f"/api/v1/bots/personalities/{pid}", headers=auth(token_user_1)).status_code == 204
    again = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert next(p for p in again["players"] if p["kind"] == "personality")["personality_name"] == "Gambiteer"


def test_other_players_tournament_is_hidden(client, token_user_1, token_user_2):
    t = client.post(API, headers=auth(token_user_1), json=body()).json()
    response = client.get(f"{API}/{t['id']}", headers=auth(token_user_2))
    assert response.status_code == 404 and response.json()["detail"]["code"] == "tournament_not_found"
    assert client.get(API, headers=auth(token_user_2)).json() == []


# --- ход турнира --------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_round_robin_finishes_with_places(client, db_session, token_user_1):
    t = client.post(API, headers=auth(token_user_1), json=body()).json()
    # Выигрывает тот, у кого номер меньше (сильнее по посеву), 1 и 2 играют вничью.
    await play(db_session, t["id"], lambda g: "1/2-1/2" if {g.white_seat, g.black_seat} == {1, 2}
               else "1-0" if g.white_seat < g.black_seat else "0-1")

    done = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert done["status"] == "finished" and done["finished_at"]
    table = {s["seat"]: s for s in done["standings"]}
    assert (table[1]["points"], table[2]["points"], table[3]["points"], table[4]["points"]) == (2.5, 2.5, 1, 0)
    places = {p["seat"]: p["place"] for p in done["players"]}
    assert places == {1: 1, 2: 2, 3: 3, 4: 4}
    summary = client.get(API, headers=auth(token_user_1)).json()
    assert summary[0]["status"] == "finished" and summary[0]["my_place"] == 4
    # После завершения можно начать новый турнир.
    assert client.post(API, headers=auth(token_user_1), json=body()).status_code == 201


@pytest.mark.asyncio
async def test_knockout_draws_go_to_rematch_and_armageddon(client, db_session, token_user_1):
    t = client.post(API, headers=auth(token_user_1), json=body("knockout", 4)).json()
    tournament = await db_session.get(Tournament, t["id"])
    games = {g.board: g for g in await service.games_of(db_session, t["id"])}

    await service.record_result(db_session, tournament, games[1], "1/2-1/2")
    rematch = [g for g in await service.games_of(db_session, t["id"]) if g.board == 1 and g.stage == "rematch"]
    assert len(rematch) == 1
    assert (rematch[0].white_seat, rematch[0].black_seat) == (4, 1)
    assert (rematch[0].base_time_ms, rematch[0].increment_ms) == (150_000, 0)

    await service.record_result(db_session, tournament, rematch[0], "1/2-1/2")
    armageddon = [g for g in await service.games_of(db_session, t["id"]) if g.stage == "armageddon"][0]
    assert (armageddon.white_seat, armageddon.black_seat) == (4, 1)
    await service.record_result(db_session, tournament, armageddon, "1/2-1/2")  # чёрным хватает ничьей

    # Матч 2–3 решается в основной партии; затем — финал 1–2.
    await service.record_result(db_session, tournament, games[2], "0-1")
    await db_session.refresh(tournament)
    assert tournament.current_round == 2
    final = [g for g in await service.games_of(db_session, t["id"]) if g.round == 2]
    assert [(g.white_seat, g.black_seat, g.stage) for g in final] == [(1, 3, "main")]

    await service.record_result(db_session, tournament, final[0], "0-1")
    done = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert done["status"] == "finished"
    assert {p["seat"]: p["place"] for p in done["players"]} == {3: 1, 1: 2, 2: 3, 4: 3}
    assert {p["seat"]: p["eliminated_round"] for p in done["players"]} == {1: 2, 2: 1, 3: None, 4: 1}


@pytest.mark.asyncio
async def test_knockout_of_eight_runs_to_the_end(client, db_session, token_user_1):
    t = client.post(API, headers=auth(token_user_1), json=body("knockout", 8, eight())).json()
    await play(db_session, t["id"], lambda g: "1-0" if g.white_seat < g.black_seat else "0-1")  # сильнейший проходит
    done = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    places = {p["seat"]: p["place"] for p in done["players"]}
    assert places == {1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5, 7: 5, 8: 5}
    semifinal = [(g["white_seat"], g["black_seat"]) for g in done["games"] if g["round"] == 2]
    assert semifinal == [(1, 4), (2, 3)]


@pytest.mark.asyncio
async def test_finished_game_cannot_be_recorded_twice(client, db_session, token_user_1):
    t = client.post(API, headers=auth(token_user_1), json=body()).json()
    tournament = await db_session.get(Tournament, t["id"])
    game = (await db_session.execute(select(TournamentGame).where(TournamentGame.tournament_id == t["id"]))).scalars().first()
    await service.record_result(db_session, tournament, game, "1-0")
    with pytest.raises(service.DomainError) as error:
        await service.record_result(db_session, tournament, game, "0-1")
    assert error.value.code == "tournament_game_closed"
