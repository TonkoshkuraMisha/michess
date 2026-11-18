# --- FILE: tests/test_conference_matches.py ---
"""
Матчи конференций (таск 33.6, схема владельца 18.11): чистые правила (круг, общий вечер, составы, цвета, запись) и
настоящий путь клиента — запись через POST /arenas/{id}/join, отказы, составы на старте, два тура настоящих партий и
счёт матча на странице арены.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.user import User
from src.services import arena
from src.services import conference_match_rules as rules
from src.services.arena_schedule import CONFERENCE_ZONES
from src.services.game_state import state_manager

API = "/api/v1/arenas"
SATURDAY = date(2026, 11, 21)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- чистые правила ---------------------------------------------------------------------------------------------

def test_round_robin_plays_every_pair_once_and_rounds_do_not_overlap():
    assert len(rules.PAIRS) == 10
    assert len({frozenset(pair) for pair in rules.PAIRS}) == 10
    assert {c for pair in rules.PAIRS for c in pair} == set(CONFERENCE_ZONES)
    for first, second in zip(rules.PAIRS[::2], rules.PAIRS[1::2], strict=True):  # тур — две пары без общих конференций
        assert not set(first) & set(second)


def test_hosts_alternate_between_cycles():
    home, guest = rules.fixture(3)
    assert rules.fixture(3 + len(rules.PAIRS)) == (guest, home)
    assert rules.fixture(3 + 2 * len(rules.PAIRS)) == (home, guest)


def test_match_time_is_a_common_evening_or_the_host_evening():
    # Киев и Берлин: 19:00 в Киеве — 18:00 в Берлине, вечер у обеих.
    assert rules.match_start("central", "northern", SATURDAY) == datetime(2026, 11, 21, 17, 0, tzinfo=UTC)
    # Киев и Нью-Йорк: общего вечера нет — 19:00 хозяина.
    assert rules.match_start("central", "western", SATURDAY) == datetime(2026, 11, 21, 17, 0, tzinfo=UTC)
    assert rules.match_start("western", "central", SATURDAY) == datetime(2026, 11, 22, 0, 0, tzinfo=UTC)


def test_planned_matches_are_weekly_on_saturday():
    now = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)
    matches = rules.planned_matches(now, rules.MATCH_LOOKAHEAD)
    assert len(matches) in (1, 2)
    first = matches[0]
    assert first.starts_at > now and (first.home, first.guest) == rules.fixture((SATURDAY - rules.EPOCH).days // 7)
    assert first.schedule_key == f"{first.home}-{first.guest}:{rules.MATCH_SLOT.key}"
    assert rules.planned_matches(now, rules.MATCH_LOOKAHEAD, active=("central",)) == []


class _M:
    def __init__(self, user_id: int, rating: int, conference: str):
        self.user_id, self.rating, self.conference = user_id, rating, conference


def test_lineup_by_rating_with_boards_of_the_smaller_side():
    members = [_M(1, 1500, "central"), _M(2, 1800, "central"), _M(3, 1500, "central"), _M(4, 1600, "western"),
               _M(5, 1900, "western"), _M(6, 2000, "northern")]
    boards = rules.lineup(members, "central", "western", [3, 1, 2, 4, 5, 6])
    assert [(h.user_id, g.user_id) for h, g in boards] == [(2, 5), (3, 4)]   # равные 1500 — раньше записавшийся


def test_colors_alternate_by_board_and_round():
    assert [rules.board_colors(b, 1) for b in (1, 2, 3)] == [True, False, True]
    assert [rules.board_colors(b, 2) for b in (1, 2, 3)] == [False, True, False]


def test_entry_closes_an_hour_before_the_start():
    start = datetime(2026, 11, 21, 17, 0, tzinfo=UTC)
    assert rules.entry_open(start, start - timedelta(hours=2))
    assert not rules.entry_open(start, start - timedelta(minutes=30))


# --- путь клиента -----------------------------------------------------------------------------------------------

@pytest.fixture
async def match(db_session, test_user_1, test_user_2):
    test_user_1.country, test_user_1.blitz_rating = "UA", 1600
    test_user_2.country, test_user_2.blitz_rating = "US", 1700
    extra = {
        "c2": User(username="central2", hashed_password="x", country="PL", blitz_rating=1400),
        "w2": User(username="western2", hashed_password="x", country="CA", blitz_rating=1300),
        "north": User(username="north1", hashed_password="x", country="DE", blitz_rating=1500),
        "nowhere": User(username="nowhere1", hashed_password="x", blitz_rating=1500),
    }
    db_session.add_all(extra.values())
    now = datetime.now(UTC)
    item = Arena(base_time_ms=300_000, increment_ms=3_000, format="match", rounds=2, conference="central",
                 opponent_conference="western", starts_at=now + timedelta(hours=2), ends_at=now + timedelta(hours=4))
    db_session.add(item)
    await db_session.commit()
    return item, extra


async def test_conference_match_through_the_client(client, db_session, match, token_user_1, token_user_2,
                                                   test_user_1, test_user_2):
    item, extra = match
    for token in (token_user_1, token_user_2):
        assert client.post(f"{API}/{item.id}/join", headers=auth(token)).status_code == 200
    for key in ("c2", "w2"):
        await arena.join(db_session, item, extra[key])
    with pytest.raises(arena.DomainError) as wrong:
        await arena.join(db_session, item, extra["north"])
    assert wrong.value.code == "match_wrong_conference"
    with pytest.raises(arena.DomainError) as none:
        await arena.join(db_session, item, extra["nowhere"])
    assert none.value.code == "match_no_conference"

    page = client.get(f"{API}/{item.id}").json()
    assert (page["format"], page["status"], page["opponent_conference"]) == ("match", "scheduled", "western")
    preview = page["match"]
    assert (preview["home"], preview["guest"], preview["entry_open"]) == ("central", "western", True)
    assert [(b["home"]["username"], b["guest"]["username"]) for b in preview["boards"]] == [
        (test_user_1.username, test_user_2.username), ("central2", "western2")]

    # Матч начался: составы записаны, первый тур — хозяин белыми на первой доске, чёрными на второй.
    item.starts_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    assert client.get(f"{API}/{item.id}").json()["current_round"] == 1
    boards = {p.user_id: p.board for p in (await db_session.execute(
        select(ArenaPlayer).where(ArenaPlayer.arena_id == item.id))).scalars()}
    assert boards == {test_user_1.id: 1, test_user_2.id: 1, extra["c2"].id: 2, extra["w2"].id: 2}
    first = list((await db_session.execute(select(ArenaGame).where(ArenaGame.arena_id == item.id, ArenaGame.round == 1)
                                           .order_by(ArenaGame.id))).scalars())
    assert {(g.white_id, g.black_id) for g in first} == {(test_user_1.id, test_user_2.id), (extra["w2"].id, extra["c2"].id)}

    for game in first:  # первая доска — победа хозяина, вторая — ничья
        await state_manager.finish_game(db_session, game.game_id, "1-0" if game.white_id == test_user_1.id else "1/2-1/2",
                                        termination="resignation" if game.white_id == test_user_1.id else "agreement")
    await db_session.refresh(item)
    assert item.current_round == 2
    second = list((await db_session.execute(select(ArenaGame).where(ArenaGame.arena_id == item.id, ArenaGame.round == 2)
                                            )).scalars())
    assert {(g.white_id, g.black_id) for g in second} == {(test_user_2.id, test_user_1.id), (extra["c2"].id, extra["w2"].id)}
    for game in second:  # во втором туре обе партии выиграл гость
        await state_manager.finish_game(db_session, game.game_id, "1-0" if game.white_id == test_user_2.id else "0-1",
                                        termination="resignation")
    await db_session.refresh(item)
    assert item.finished_at is not None

    final = client.get(f"{API}/{item.id}").json()
    assert final["status"] == "finished"
    assert (final["match"]["home_score"], final["match"]["guest_score"]) == (1.5, 2.5)
    assert final["match"]["boards"][0]["home"]["score"] == 1.0
    # Тот же счёт — в списке матчей страницы конференций.
    listed = next(m for m in client.get("/api/v1/conferences").json()["matches"] if m["arena_id"] == item.id)
    assert (listed["home"], listed["guest"], listed["home_score"], listed["guest_score"], listed["players"]) == (
        "central", "western", 1.5, 2.5, 4)


async def test_entry_closes_before_the_start(client, db_session, match, token_user_1):
    item, _ = match
    item.starts_at = datetime.now(UTC) + timedelta(minutes=30)
    await db_session.commit()
    refused = client.post(f"{API}/{item.id}/join", headers=auth(token_user_1))
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "match_entry_closed"


async def test_match_without_boards_ends_without_games(client, db_session, match, token_user_1):
    item, _ = match
    assert client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).status_code == 200   # только хозяин
    item.starts_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    page = client.get(f"{API}/{item.id}").json()
    assert page["status"] == "finished" and page["match"]["boards"] == []
