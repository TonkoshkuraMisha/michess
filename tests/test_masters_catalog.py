# --- FILE: tests/test_masters_catalog.py ---
"""
Каталог мастеров прошлого (таск 28.5): список участников исторических турниров, характер мастера для
отдельной партии и сохранение такой партии вне турнира.
"""

from src.services.bots.guests import GUESTS, GUESTS_BY_ID, SIGNATURE_OPENINGS
from src.services.time_machine import EVENTS_BY_KEY

API = "/api/v1/bots"
FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_catalog_lists_every_master_with_tournaments_and_openings(client):
    guests = client.get(f"{API}/guests").json()["guests"]
    assert [g["id"] for g in guests] == [g.id for g in GUESTS]
    for row in guests:
        guest = GUESTS_BY_ID[row["id"]]
        assert (row["pgn_name"], row["era"], row["rating"]) == (guest.pgn_name, guest.era, guest.rating)
        # Мастер прошлого попадает в реестр только вместе с турниром, в котором играл.
        assert row["events"] and all(row["id"] in {e.id for e in EVENTS_BY_KEY[key].field} for key in row["events"])
        white, black = SIGNATURE_OPENINGS.get(row["id"], ((), ()))
        assert row["openings"] == {"white": list(white), "black": list(black)}
        # Только ключи и числа: текста для игрока в ответе нет (имя и строка о мастере — в каталогах клиента).
        assert set(row) == {"id", "pgn_name", "era", "rating", "events", "openings"}
    keres = next(g for g in guests if g["id"] == "keres")
    assert "avro_1938" in keres["events"]
    # Турниры мастера идут по годам.
    for row in guests:
        years = [EVENTS_BY_KEY[key].year for key in row["events"]]
        assert years == sorted(years), row["id"]


def test_master_config_is_the_one_he_plays_with_in_the_time_machine(client):
    keres = client.get(f"{API}/guests/keres").json()
    guest = GUESTS_BY_ID["keres"]
    assert (keres["id"], keres["pgn_name"], keres["rating"]) == ("keres", guest.pgn_name, guest.rating)
    assert keres["config"] == guest.config.model_dump() and keres["config"]["target_elo"] == guest.rating

    missing = client.get(f"{API}/guests/nobody")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "guest_not_found"


def test_single_game_against_a_master_is_saved_outside_a_tournament(client, token_user_1):
    guest = GUESTS_BY_ID["kieseritzky"]
    saved = client.post(f"{API}/save-game", headers=auth(token_user_1), json={
        "bot_id": "custom", "personality_name": guest.pgn_name, "player_color": "white", "result": "0-1",
        "moves_uci": FOOLS_MATE, "base_time_ms": 600_000, "increment_ms": 0,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["tournament_id"] is None
    pgn = client.get(f"/api/v1/profile/games/{saved.json()['game_id']}/pgn", headers=auth(token_user_1))
    assert pgn.status_code == 200 and guest.pgn_name in pgn.text and str(guest.rating) in pgn.text
