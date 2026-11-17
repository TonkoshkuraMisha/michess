# --- FILE: tests/test_conferences.py ---
"""Конференции (таск 33.6): страны, выбор страны в профиле и смена раз в сезон, зачёт арены, Кубок конференций."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.core.config import settings
from src.core.errors import DomainError
from src.models.arena import Arena, ArenaPlayer
from src.models.user import User
from src.services import arena, conferences
from src.services.arena_schedule import CONFERENCE_ZONES

API = "/api/v1/conferences"
NOVEMBER = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)
DECEMBER = datetime(2026, 12, 2, 12, 0, tzinfo=UTC)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _players(db, count: int, country: str | None, prefix: str) -> list[User]:
    users = [User(username=f"{prefix}{i}", hashed_password="x", country=country) for i in range(count)]
    db.add_all(users)
    await db.commit()
    return users


# --- Таблица стран -------------------------------------------------------------------------------------------


def test_every_country_is_in_exactly_one_conference():
    codes = [code for group in conferences.COUNTRIES.values() for code in group]
    assert len(codes) == len(set(codes)) == 250                                 # 249 кодов ISO 3166-1 и XK (Косово)
    assert all(len(code) == 2 and code.isupper() for code in codes)
    assert set(conferences.COUNTRIES) == set(CONFERENCE_ZONES)                  # те же пять, что у расписания арен


@pytest.mark.parametrize(("country", "conference"), [
    ("UA", "central"), ("PL", "central"), ("GE", "central"),
    ("FR", "western"), ("US", "western"), ("BR", "western"),
    ("DE", "northern"), ("GB", "northern"), ("NO", "northern"),
    ("IT", "southern"), ("TR", "southern"), ("EG", "southern"), ("ZA", "southern"),
    ("RU", "eastern"), ("BY", "eastern"), ("IN", "eastern"), ("CN", "eastern"), ("AU", "eastern"),
    ("ua", "central"), (None, None), ("ZZ", None), ("", None),
])
def test_conference_of_a_country(country, conference):
    assert conferences.conference_of(country) == conference


# --- Страна в профиле ----------------------------------------------------------------------------------------


async def test_country_through_the_real_client_path(client, db_session, test_user_1, token_user_1, monkeypatch):
    headers = auth(token_user_1)
    page = client.get(API, headers=headers).json()
    assert page["me"] == {"country": None, "conference": None, "can_change": True}
    assert page["countries"]["UA"] == "central" and len(page["countries"]) == 250
    assert [item["key"] for item in page["conferences"]] == list(CONFERENCE_ZONES)
    assert page["suggested_country"] is None                                    # подсказка по адресу выключена
    assert client.get(API).json()["me"] is None                                 # гость видит кубок без профиля

    # Первый выбор и смена страны внутри конференции — свободно.
    assert client.put(f"{API}/me", json={"country": "ua"}, headers=headers).json() == {
        "country": "UA", "conference": "central", "can_change": True}
    assert client.put(f"{API}/me", json={"country": "PL"}, headers=headers).json()["conference"] == "central"
    me = client.get("/api/v1/profile/me", headers=headers).json()
    assert (me["country"], me["conference"]) == ("PL", "central")

    # Смена конференции — раз в сезон: вторая попытка в том же месяце получает отказ.
    moved = client.put(f"{API}/me", json={"country": "DE"}, headers=headers).json()
    assert moved == {"country": "DE", "conference": "northern", "can_change": False}
    again = client.put(f"{API}/me", json={"country": "IT"}, headers=headers)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "country_change_too_soon"
    assert client.put(f"{API}/me", json={"country": "GB"}, headers=headers).json()["country"] == "GB"   # та же конференция

    assert client.put(f"{API}/me", json={"country": "ZZ"}, headers=headers).json()["detail"]["code"] == "country_unknown"
    assert client.put(f"{API}/me", json={"country": "Ukraine"}, headers=headers).status_code == 422
    assert client.put(f"{API}/me", json={"country": "UA"}).status_code == 401

    # Убрать страну можно всегда; вернуться в конференцию в том же сезоне уже нельзя.
    assert client.put(f"{API}/me", json={"country": None}, headers=headers).json() == {
        "country": None, "conference": None, "can_change": False}
    assert client.put(f"{API}/me", json={"country": "UA"}, headers=headers).status_code == 409

    # Прокси назвал страну посетителя — она приходит только как подсказка.
    monkeypatch.setattr(settings, "COUNTRY_HEADER", "CF-IPCountry")
    assert client.get(API, headers={"CF-IPCountry": "ua"}).json()["suggested_country"] == "UA"
    assert client.get(API, headers={"CF-IPCountry": "T1"}).json()["suggested_country"] is None
    assert (await db_session.get(User, test_user_1.id, populate_existing=True)).country is None


async def test_conference_changes_once_a_season(db_session, test_user_1):
    assert (await conferences.set_country(db_session, test_user_1, "UA", NOVEMBER))["can_change"] is True
    assert (await conferences.set_country(db_session, test_user_1, "US", NOVEMBER))["can_change"] is False
    with pytest.raises(DomainError) as refused:
        await conferences.set_country(db_session, test_user_1, "RU", NOVEMBER)
    assert refused.value.code == "country_change_too_soon"
    assert test_user_1.country == "US"
    # Следующий сезон — новый месяц: смена снова возможна.
    assert conferences.membership(test_user_1, DECEMBER)["can_change"] is True
    moved = await conferences.set_country(db_session, test_user_1, "RU", DECEMBER)
    assert moved == {"country": "RU", "conference": "eastern", "can_change": False}
    assert test_user_1.country_season == "2026-12"


# --- Зачёт арены и Кубок -------------------------------------------------------------------------------------


def test_team_score_is_the_sum_of_the_ten_best():
    rows = [("central", score) for score in range(1, 13)] + [("eastern", 30), ("eastern", 0), (None, 99), ("lunar", 50)]
    assert conferences.team_scores(rows) == [
        {"conference": "central", "score": sum(range(3, 13)), "counted": 10, "players": 12},   # 1 и 2 очка — вне зачёта
        {"conference": "eastern", "score": 30, "counted": 2, "players": 2},
    ]
    assert conferences.team_scores([("western", 4), ("central", 4)])[0]["conference"] == "central"   # равенство — по порядку


async def test_arena_remembers_the_conference_at_entry(client, db_session, test_user_1, test_user_2, token_user_1):
    now = datetime.now(UTC)
    item = Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - timedelta(minutes=5),
                 ends_at=now + timedelta(minutes=50), conference="western")
    db_session.add(item)
    await db_session.commit()
    await conferences.set_country(db_session, test_user_1, "UA")
    assert client.post(f"/api/v1/arenas/{item.id}/join", headers=auth(token_user_1)).status_code == 200
    await arena.join(db_session, item, test_user_2)                             # без страны — без конференции

    # Игрок Центральной играет в арене Западной: очки идут его конференции. Смена страны после входа зачёт не меняет.
    await conferences.set_country(db_session, test_user_1, "DE")
    rows = {p.user_id: p for p in (await db_session.execute(select(ArenaPlayer))).scalars()}
    assert (rows[test_user_1.id].conference, rows[test_user_2.id].conference) == ("central", None)
    rows[test_user_1.id].score, rows[test_user_2.id].score = 6, 9
    await db_session.commit()
    view = client.get(f"/api/v1/arenas/{item.id}").json()
    assert view["conferences"] == [{"conference": "central", "score": 6, "counted": 1, "players": 1}]
    assert {row["username"]: row["conference"] for row in view["standings"]} == {"player1": "central", "player2": None}


async def test_cup_sums_the_arenas_of_the_season(client, db_session):
    def arena_at(moment: datetime) -> Arena:
        return Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=moment, ends_at=moment + timedelta(hours=1))

    first, second = arena_at(NOVEMBER), arena_at(NOVEMBER + timedelta(days=3))
    october = arena_at(datetime(2026, 10, 30, tzinfo=UTC))
    db_session.add_all([first, second, october])
    central = await _players(db_session, 12, "UA", "c")
    eastern = await _players(db_session, 2, "IN", "e")

    def entry(item: Arena, user: User, score: int) -> ArenaPlayer:
        return ArenaPlayer(arena_id=item.id, user_id=user.id, rating=1500, score=score,
                           conference=conferences.conference_of(user.country))

    db_session.add_all([entry(first, user, 2) for user in central]                # 12 игроков по 2 очка: в зачёт — 10
                       + [entry(first, eastern[0], 7), entry(second, eastern[0], 5), entry(second, eastern[1], 0)]
                       + [entry(october, central[0], 50)])                       # прошлый сезон — в свой кубок
    await db_session.commit()

    cup = await conferences.cup(db_session, None, NOVEMBER)
    assert (cup["season"], cup["top_players"]) == ("2026-11", 10)
    assert cup["table"] == [
        {"conference": "central", "score": 20, "arenas": 1},
        {"conference": "eastern", "score": 12, "arenas": 2},
        {"conference": "western", "score": 0, "arenas": 0},
        {"conference": "northern", "score": 0, "arenas": 0},
        {"conference": "southern", "score": 0, "arenas": 0},
    ]
    past = client.get(f"{API}?season=2026-10").json()
    assert past["season"] == "2026-10" and past["table"][0] == {"conference": "central", "score": 50, "arenas": 1}
    assert client.get(f"{API}?season=2026-13").status_code == 422
