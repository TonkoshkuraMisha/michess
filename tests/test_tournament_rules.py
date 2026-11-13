# --- FILE: tests/test_tournament_rules.py ---
"""Правила турниров (таск 15.1): таблицы Бергера, места кругового турнира, матчи и сетка на выбывание."""

from itertools import combinations

import pytest

from src.services.tournament_rules import (
    GameRecord,
    berger_rounds,
    knockout_first_round,
    knockout_next_round,
    knockout_places,
    match_game,
    match_state,
    round_robin_standings,
    shortened_control,
)

# Опубликованные таблицы Бергера ФИДЕ.
FIDE_BERGER_4 = [[(1, 4), (2, 3)], [(4, 3), (1, 2)], [(2, 4), (3, 1)]]
FIDE_BERGER_6 = [
    [(1, 6), (2, 5), (3, 4)],
    [(6, 4), (5, 3), (1, 2)],
    [(2, 6), (3, 1), (4, 5)],
    [(6, 5), (1, 4), (2, 3)],
    [(3, 6), (4, 2), (5, 1)],
]


def test_berger_matches_fide_tables():
    assert berger_rounds(4) == FIDE_BERGER_4
    assert berger_rounds(6) == FIDE_BERGER_6


@pytest.mark.parametrize("n", [4, 6, 8])
def test_round_robin_everyone_meets_once_and_colors_balance(n):
    rounds = berger_rounds(n)
    assert len(rounds) == n - 1
    pairs = [tuple(sorted(p)) for rnd in rounds for p in rnd]
    assert sorted(pairs) == sorted(combinations(range(1, n + 1), 2))
    for rnd in rounds:
        assert sorted(s for p in rnd for s in p) == list(range(1, n + 1))  # каждый играет в каждом туре
    whites = {s: sum(1 for rnd in rounds for w, _ in rnd if w == s) for s in range(1, n + 1)}
    assert max(whites.values()) - min(whites.values()) <= 1


@pytest.mark.parametrize("n", [3, 5, 10])
def test_round_robin_sizes(n):
    with pytest.raises(ValueError):
        berger_rounds(n)


def test_standings_points_then_head_to_head_then_sonneborn_berger():
    # 1 и 2 набрали по 2 очка, 2 выиграл личную встречу → 2 выше; 3 и 4 по 1 очку, личная встреча — ничья,
    # Зоннеборн–Бергер: 3 сделал ничью с лидером (2 очка → 1), 4 — с 1 (2 очка → 1)... разводим примером ниже.
    games = [
        GameRecord(2, 1, "1-0"),
        GameRecord(1, 3, "1-0"),
        GameRecord(1, 4, "1-0"),
        GameRecord(2, 3, "0-1"),
        GameRecord(4, 2, "0-1"),
        GameRecord(3, 4, "1/2-1/2"),
    ]
    table = round_robin_standings([1, 2, 3, 4], games)
    assert [(s.seat, s.points) for s in table] == [(2, 2.0), (1, 2.0), (3, 1.5), (4, 0.5)]
    assert table[0].head_to_head == 1.0 and table[1].head_to_head == 0.0


def test_sonneborn_berger_breaks_tie_when_head_to_head_is_equal():
    # 3 и 4 по 1,5 очка, между собой ничья. 3 обыграл сильнейшего (1, 2 очка), 4 — слабейшего.
    games = [
        GameRecord(1, 2, "1-0"),
        GameRecord(1, 4, "1-0"),
        GameRecord(3, 1, "1-0"),
        GameRecord(2, 3, "1-0"),
        GameRecord(4, 2, "1-0"),
        GameRecord(3, 4, "1/2-1/2"),
    ]
    table = {s.seat: s for s in round_robin_standings([1, 2, 3, 4], games)}
    assert table[3].points == table[4].points == 1.5
    assert table[3].head_to_head == table[4].head_to_head == 0.5
    assert table[3].sonneborn_berger > table[4].sonneborn_berger
    assert table[3].place < table[4].place


def test_full_tie_falls_back_to_seeding():
    games = [GameRecord(1, 2, "1/2-1/2")]
    assert [s.seat for s in round_robin_standings([2, 1], games)] == [1, 2]


def test_knockout_bracket_keeps_top_seeds_apart():
    assert knockout_first_round(8) == [(1, 8), (4, 5), (2, 7), (3, 6)]
    assert knockout_next_round([1, 4, 2, 3]) == [(1, 4), (2, 3)]
    assert knockout_next_round([4, 1]) == [(1, 4)]
    with pytest.raises(ValueError):
        knockout_first_round(6)


def test_match_decided_in_main_game():
    assert match_state(1, 8, [("main", GameRecord(1, 8, "0-1"))]).winner == 8


def test_draw_leads_to_rematch_with_swapped_colors_then_armageddon():
    first = match_state(1, 8, [])
    assert first.next_game == match_game(1, 8, "main") and (first.next_game.white, first.next_game.black) == (1, 8)

    after_draw = match_state(1, 8, [("main", GameRecord(1, 8, "1/2-1/2"))])
    rematch = after_draw.next_game
    assert after_draw.winner is None and rematch is not None
    assert (rematch.stage, rematch.white, rematch.black, rematch.shortened) == ("rematch", 8, 1, True)

    two_draws = [("main", GameRecord(1, 8, "1/2-1/2")), ("rematch", GameRecord(8, 1, "1/2-1/2"))]
    armageddon = match_state(1, 8, two_draws).next_game
    assert armageddon is not None and (armageddon.stage, armageddon.white, armageddon.black) == ("armageddon", 8, 1)

    # В решающей партии ничья — победа чёрных (сеяного выше).
    decided = match_state(1, 8, [*two_draws, ("armageddon", GameRecord(8, 1, "1/2-1/2"))])
    assert decided.winner == 1 and decided.next_game is None
    assert match_state(1, 8, [*two_draws, ("armageddon", GameRecord(8, 1, "1-0"))]).winner == 8


def test_shortened_control_is_half_but_at_least_a_minute():
    assert shortened_control(600_000, 5_000) == (300_000, 2_500)
    assert shortened_control(60_000, 0) == (60_000, 0)


def test_knockout_places():
    # Восемь: 1 — чемпион, 2 — финалист, 4 и 3 вылетели в полуфинале, остальные в четвертьфинале.
    places = knockout_places(8, {8: 1, 5: 1, 7: 1, 6: 1, 4: 2, 3: 2, 2: 3}, champion=1)
    assert places == {1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5, 7: 5, 8: 5}
    assert knockout_places(4, {4: 1, 3: 1, 2: 2}, champion=1) == {1: 1, 2: 2, 3: 3, 4: 3}
