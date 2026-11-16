# --- FILE: tests/test_tournament_big.py ---
"""
Большие турниры («Машина времени», таск 28.1): круговой на любое число участников и в несколько кругов, сетка на
любое число участников с проходом первого круга без игры, места в большой сетке.
"""

from itertools import combinations

import pytest

from src.core.errors import DomainError
from src.models.tournament import Tournament
from src.services import tournaments as service
from src.services.tournament_rules import (
    berger_rounds,
    bracket_size,
    bracket_slots,
    knockout_first_round,
    knockout_places,
    round_robin_schedule,
)

BOTS = ("morphy", "philidor", "staunton", "anderssen", "paulsen", "zukertort", "labourdonnais", "steinitz", "lasker",
        "rubinstein", "capablanca", "alekhine", "chigorin", "tarrasch", "pillsbury", "marshall", "nimzowitsch", "reti",
        "tartakower", "botvinnik", "tal", "petrosian")


def specs(count: int) -> list[service.ParticipantSpec]:
    return [service.ParticipantSpec("bot", key) for key in BOTS[:count]]


async def play(db, tournament: Tournament, outcome) -> None:
    while True:
        await db.refresh(tournament)
        pending = [g for g in await service.games_of(db, tournament.id) if g.result is None]
        if not pending or tournament.status != "active":
            return
        await service.record_result(db, tournament, pending[0], outcome(pending[0]))


# --- расписание кругового турнира ---------------------------------------------------------------------------------

@pytest.mark.parametrize("n", [4, 6, 8])
def test_schedule_equals_fide_tables_for_classic_sizes(n):
    assert round_robin_schedule(n) == berger_rounds(n)


@pytest.mark.parametrize("n", [10, 12, 16, 18, 22, 24, 26, 28])
def test_even_field_everyone_meets_once(n):
    rounds = round_robin_schedule(n)
    assert len(rounds) == n - 1
    assert sorted(tuple(sorted(pair)) for rnd in rounds for pair in rnd) == sorted(combinations(range(1, n + 1), 2))
    for rnd in rounds:
        assert sorted(seat for pair in rnd for seat in pair) == list(range(1, n + 1))
    whites = [sum(1 for rnd in rounds for white, _ in rnd if white == seat) for seat in range(1, n + 1)]
    assert max(whites) - min(whites) <= 1


@pytest.mark.parametrize("n", [3, 5, 9, 17, 23, 27])
def test_odd_field_gives_everyone_one_free_round(n):
    rounds = round_robin_schedule(n)
    assert len(rounds) == n
    assert sorted(tuple(sorted(pair)) for rnd in rounds for pair in rnd) == sorted(combinations(range(1, n + 1), 2))
    free = []
    for rnd in rounds:
        busy = [seat for pair in rnd for seat in pair]
        assert len(busy) == len(set(busy)) == n - 1
        free += [seat for seat in range(1, n + 1) if seat not in busy]
    assert sorted(free) == list(range(1, n + 1))  # каждый свободен ровно один тур
    whites = [sum(1 for rnd in rounds for white, _ in rnd if white == seat) for seat in range(1, n + 1)]
    assert max(whites) == min(whites) == (n - 1) // 2


def test_second_cycle_repeats_pairs_with_colours_reversed():
    once, twice = round_robin_schedule(6), round_robin_schedule(6, cycles=2)
    assert twice[:5] == once
    assert twice[5:] == [[(black, white) for white, black in rnd] for rnd in once]
    four = round_robin_schedule(7, cycles=4)  # Нью-Йорк 1927: шестеро мастеров в четыре круга + игрок
    assert len(four) == 28
    meetings = [tuple(sorted(pair)) for rnd in four for pair in rnd]
    assert all(meetings.count(pair) == 4 for pair in combinations(range(1, 8), 2))
    for a, b in combinations(range(1, 8), 2):
        assert sum(1 for rnd in four for pair in rnd if pair == (a, b)) == 2  # цвета поровну


@pytest.mark.parametrize(("n", "cycles"), [(2, 1), (29, 1), (8, 0), (8, 7)])
def test_schedule_limits(n, cycles):
    with pytest.raises(ValueError):
        round_robin_schedule(n, cycles)


# --- сетка ---------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("n", [4, 8])
def test_bracket_equals_classic_first_round(n):
    assert bracket_slots(n) == knockout_first_round(n)


def test_bracket_of_sixteen_keeps_top_seeds_apart():
    assert bracket_slots(16) == [(1, 16), (8, 9), (4, 13), (5, 12), (2, 15), (7, 10), (3, 14), (6, 11)]


def test_seventeen_players_have_one_play_in_match():
    # Лондон 1851: шестнадцать мастеров и игрок. Сетка на 32: играют только 16-й и 17-й номера, остальные проходят.
    slots = bracket_slots(17)
    assert len(slots) == 16 and bracket_size(17) == 32
    assert [(high, low) for high, low in slots if low is not None] == [(16, 17)]
    assert sorted(high for high, _ in slots) == list(range(1, 17))
    assert slots[0] == (1, None)


@pytest.mark.parametrize("n", range(3, 34))
def test_bracket_has_every_player_once_and_byes_go_to_top_seeds(n):
    slots = bracket_slots(n)
    seats = [seat for pair in slots for seat in pair if seat is not None]
    assert sorted(seats) == list(range(1, n + 1))
    byes = sorted(high for high, low in slots if low is None)
    assert byes == list(range(1, bracket_size(n) - n + 1))  # без игры проходят сильнейшие по посеву
    assert all(high < low for high, low in slots if low is not None)


@pytest.mark.parametrize("n", [2, 34])
def test_bracket_limits(n):
    with pytest.raises(ValueError):
        bracket_slots(n)


def test_places_in_a_big_bracket():
    # 16 участников, 4 круга: вылет в первом круге — 9-е место, во втором — 5-е, в полуфинале — 3-е, финал — 2-е.
    out = {seat: 1 for seat in range(9, 17)} | {5: 2, 6: 2, 7: 2, 8: 2, 3: 3, 4: 3, 2: 4}
    places = knockout_places(16, out, champion=1)
    assert [places[seat] for seat in range(1, 17)] == [1, 2, 3, 3, 5, 5, 5, 5, 9, 9, 9, 9, 9, 9, 9, 9]
    # 17 участников — сетка на 32: проигравший стыковой матч — 17-й.
    assert knockout_places(17, {17: 1, 2: 5}, champion=1) == {1: 1, 17: 17, 2: 2}


# --- ход большого турнира ------------------------------------------------------------------------------------------

async def test_public_creation_keeps_small_sizes(db_session, test_user_1):
    with pytest.raises(DomainError) as refused:
        await service.create_tournament(db_session, test_user_1, "round_robin", 12, specs(11), 300_000, 0)
    assert refused.value.code == "tournament_size_invalid"
    with pytest.raises(DomainError):
        await service.create_tournament(db_session, test_user_1, "knockout", 8, specs(7), 300_000, 0, cycles=2, open_size=True)
    with pytest.raises(DomainError):
        await service.create_tournament(db_session, test_user_1, "swiss", 12, specs(11), 300_000, 0, open_size=True)


async def test_round_robin_of_twenty_three_runs_to_the_end(db_session, test_user_1):
    # Гастингс 1895: 22 мастера и игрок — 23 тура, в каждом один участник свободен.
    tournament = await service.create_tournament(
        db_session, test_user_1, "round_robin", 23, specs(22), 300_000, 0, open_size=True)
    games = await service.games_of(db_session, tournament.id)
    assert len(games) == 23 * 22 // 2 and max(g.round for g in games) == 23
    assert all(sum(1 for g in games if g.round == rnd) == 11 for rnd in range(1, 24))

    await play(db_session, tournament, lambda g: "1-0" if g.white_seat < g.black_seat else "0-1")
    assert tournament.status == "finished"
    players = await service.players_of(db_session, tournament.id)
    # Сильнейший по посеву выиграл все партии: места совпали с посевом.
    assert [p.place for p in players] == list(range(1, 24))
    assert sum(1 for p in players if p.kind == "user") == 1


async def test_double_round_robin(db_session, test_user_1):
    tournament = await service.create_tournament(
        db_session, test_user_1, "round_robin", 5, specs(4), 300_000, 0, cycles=2, open_size=True)
    games = await service.games_of(db_session, tournament.id)
    assert len(games) == 20 and max(g.round for g in games) == 10
    for a, b in combinations(range(1, 6), 2):
        colours = sorted((g.white_seat, g.black_seat) for g in games if {g.white_seat, g.black_seat} == {a, b})
        assert colours == [(a, b), (b, a)]
    await play(db_session, tournament, lambda g: "1/2-1/2")
    assert tournament.status == "finished"


async def test_knockout_of_seventeen_with_byes(db_session, test_user_1):
    tournament = await service.create_tournament(
        db_session, test_user_1, "knockout", 17, specs(16), 300_000, 0, open_size=True)
    first = await service.games_of(db_session, tournament.id)
    assert [(g.white_seat, g.black_seat) for g in first] == [(16, 17)]  # один стыковой матч, остальные проходят

    await play(db_session, tournament, lambda g: "1-0" if g.white_seat < g.black_seat else "0-1")
    assert tournament.status == "finished"
    games = await service.games_of(db_session, tournament.id)
    by_round = {rnd: sorted(tuple(sorted((g.white_seat, g.black_seat))) for g in games if g.round == rnd)
                for rnd in range(1, 6)}
    assert by_round[2] == [(1, 16), (2, 15), (3, 14), (4, 13), (5, 12), (6, 11), (7, 10), (8, 9)]
    assert by_round[3] == [(1, 8), (2, 7), (3, 6), (4, 5)]
    assert by_round[4] == [(1, 4), (2, 3)] and by_round[5] == [(1, 2)]
    places = {p.seat: p.place for p in await service.players_of(db_session, tournament.id)}
    assert places[1] == 1 and places[2] == 2 and places[3] == places[4] == 3
    assert {places[seat] for seat in range(5, 9)} == {5} and {places[seat] for seat in range(9, 17)} == {9}
    assert places[17] == 17


async def test_knockout_upset_in_the_play_in_carries_through_the_bracket(db_session, test_user_1):
    # Младший по посеву выигрывает стыковой матч и занимает место старшего в сетке — против первого номера.
    tournament = await service.create_tournament(
        db_session, test_user_1, "knockout", 5, specs(4), 300_000, 0, open_size=True)
    (play_in,) = await service.games_of(db_session, tournament.id)
    assert (play_in.white_seat, play_in.black_seat) == (4, 5)
    await service.record_result(db_session, tournament, play_in, "0-1")
    second = [g for g in await service.games_of(db_session, tournament.id) if g.round == 2]
    assert sorted((g.white_seat, g.black_seat) for g in second) == [(1, 5), (2, 3)]
