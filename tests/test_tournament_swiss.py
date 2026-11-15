# --- FILE: tests/test_tournament_swiss.py ---
"""Швейцарская система (таск 15.4): пары первого тура, пары по очкам без повторов, цвета, Бухгольц, ход турнира."""

import itertools

from src.models.tournament import Tournament
from src.services import tournament_rules as rules
from src.services import tournaments as service
from tests.test_tournaments import API, auth, body, eight, play


def _record(pairs, outcome) -> list[rules.GameRecord]:
    return [rules.GameRecord(w, b, outcome(w, b)) for w, b in pairs]


def test_first_round_top_half_against_bottom_half():
    assert rules.swiss_pairings([1, 2, 3, 4, 5, 6, 7, 8], []) == [(1, 5), (6, 2), (3, 7), (8, 4)]
    assert rules.swiss_pairings([1, 2, 3, 4, 5, 6], []) == [(1, 4), (5, 2), (3, 6)]


def test_no_rematches_and_balanced_colors_over_all_rounds():
    seats = list(range(1, 9))
    games: list[rules.GameRecord] = []
    for _ in range(rules.SWISS_ROUNDS[8]):
        pairs = rules.swiss_pairings(seats, games)
        assert sorted(itertools.chain(*pairs)) == seats
        games += _record(pairs, lambda w, b: "1-0" if w < b else "0-1")  # выигрывает сеяный выше
    meetings = [frozenset((g.white, g.black)) for g in games]
    assert len(meetings) == len(set(meetings))  # 5 туров по 4 пары — без повторов
    for seat in seats:
        whites = sum(g.white == seat for g in games)
        assert whites in (2, 3)


def test_leaders_meet_each_other():
    seats = list(range(1, 9))
    first = rules.swiss_pairings(seats, [])
    games = _record(first, lambda w, b: "1-0" if w < b else "0-1")
    winners = {min(w, b) for w, b in first}
    second = rules.swiss_pairings(seats, games)
    assert {frozenset(p) for p in second if set(p) <= winners} and all(
        set(p) <= winners or not set(p) & winners for p in second)


def test_buchholz_breaks_ties():
    games = [rules.GameRecord(1, 2, "1-0"), rules.GameRecord(3, 4, "1-0"), rules.GameRecord(1, 3, "1/2-1/2"),
             rules.GameRecord(2, 4, "1-0")]
    table = {s.seat: s for s in rules.swiss_standings([1, 2, 3, 4], games)}
    assert table[1].points == table[3].points == 1.5
    assert table[1].buchholz == 2.5 and table[3].buchholz == 1.5  # соперники 1-го набрали больше
    assert table[1].place < table[3].place


async def test_swiss_tournament_runs_round_by_round_to_places(client, token_user_1, db_session):
    created = client.post(API, headers=auth(token_user_1), json=body("swiss", 8, eight()))
    assert created.status_code == 201, created.text
    t = created.json()
    assert t["format"] == "swiss" and {g["round"] for g in t["games"]} == {1}
    await play(db_session, t["id"], lambda g: "1-0" if g.white_seat < g.black_seat else "1/2-1/2")
    tournament = await db_session.get(Tournament, t["id"])
    await db_session.refresh(tournament)
    assert tournament.status == "finished" and tournament.current_round == 5
    games = await service.games_of(db_session, t["id"])
    assert len(games) == 20
    view = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert sorted(p["place"] for p in view["players"]) == list(range(1, 9))
    assert view["standings"][0]["buchholz"] > 0


async def test_withdrawn_player_loses_future_rounds(client, token_user_1, db_session):
    t = client.post(API, headers=auth(token_user_1), json=body("swiss", 6, eight()[:5])).json()
    assert client.post(f"{API}/{t['id']}/withdraw", headers=auth(token_user_1)).status_code == 200
    await play(db_session, t["id"], lambda g: "1/2-1/2")
    view = client.get(f"{API}/{t['id']}", headers=auth(token_user_1)).json()
    assert view["status"] == "finished"
    mine = view["my_seat"]
    my_games = [g for g in view["games"] if mine in (g["white_seat"], g["black_seat"])]
    assert len(my_games) == 4
    assert all(g["result"] == ("0-1" if g["white_seat"] == mine else "1-0") for g in my_games)


def test_swiss_sizes(client, token_user_1):
    bad = client.post(API, headers=auth(token_user_1), json=body("swiss", 4))
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "tournament_size_invalid"
