# --- FILE: tests/test_arena_groups.py ---
"""Допуск и группы по силе (таск 33.2): партии в контроле, честная игра, потолок группы с пиком за неделю, деления."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.arena import Arena, ArenaPlayer
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import arena

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def entry_rule(monkeypatch):
    monkeypatch.setattr(arena, "MIN_RATED_GAMES", 10)


def blitz(now: datetime, **extra) -> Arena:
    return Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - timedelta(minutes=5),
                 ends_at=now + timedelta(minutes=55), **extra)


async def test_entry_needs_rated_games_and_fair_play(client, db_session, test_user_1, token_user_1, entry_rule):
    item = blitz(datetime.now(UTC))
    db_session.add(item)
    await db_session.commit()
    refused = client.post(f"{API}/{item.id}/join", headers=auth(token_user_1))
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "arena_need_games"
    assert refused.json()["detail"]["params"] == {"need": 10, "have": 0}

    test_user_1.blitz_games_played = 12
    test_user_1.is_cheater = True
    await db_session.commit()
    assert client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).json()["detail"]["code"] == "arena_fair_play"
    test_user_1.is_cheater = False
    await db_session.commit()
    assert client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).status_code == 200


async def test_rating_band_checks_the_peak_of_the_week(client, db_session, test_user_1, test_user_2, token_user_1):
    now = datetime.now(UTC)
    band = blitz(now, max_rating=1300)
    db_session.add(band)
    test_user_1.blitz_rating = 1280
    await db_session.commit()
    # Неделю назад игрок был 1450 и «слил» рейтинг — в группу до 1300 не пускаем.
    db_session.add(Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED,
                        is_rated=True, base_time_ms=180_000, increment_ms=2_000, result="1-0",
                        white_initial_rating=1440, white_rating_delta=10, black_initial_rating=1500,
                        black_rating_delta=-10, finished_at=now - timedelta(days=3)))
    await db_session.commit()
    high = client.post(f"{API}/{band.id}/join", headers=auth(token_user_1))
    assert high.status_code == 403 and high.json()["detail"] == {
        "code": "arena_rating_too_high", "params": {"limit": 1300}, "message": high.json()["detail"]["message"]}
    # Пик старше недели не мешает.
    old = (await db_session.execute(select(Game))).scalars().first()
    old.finished_at = now - timedelta(days=9)
    await db_session.commit()
    assert client.post(f"{API}/{band.id}/join", headers=auth(token_user_1)).json()["arena_id"] == band.id
    view = client.get(f"{API}/{band.id}").json()
    assert view["max_rating"] == 1300 and view["division"] == 1


async def test_overflow_opens_a_new_division(client, db_session, test_user_1, token_user_1, monkeypatch):
    monkeypatch.setattr(arena, "DIVISION_SIZE", 2)
    item = blitz(datetime.now(UTC))
    others = [User(username=f"filler{i}", hashed_password="x") for i in range(2)]
    db_session.add_all([item, *others])
    await db_session.commit()
    for user in others:
        await arena.join(db_session, item, user)
    joined = client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).json()
    second = joined["arena_id"]
    assert second != item.id
    division = await db_session.get(Arena, second)
    assert (division.parent_id, division.division) == (item.id, 2)
    assert arena._aware(division.ends_at) == arena._aware(item.ends_at)                # те же время и правила
    # Повторный вход — то же место; со страницы первой арены клиент узнаёт, где игрок.
    assert client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).json()["arena_id"] == second
    me = client.get(f"{API}/{item.id}", headers=auth(token_user_1)).json()["me"]
    assert (me["joined"], me["division_arena_id"]) == (False, second)
    total = (await db_session.execute(select(ArenaPlayer).where(ArenaPlayer.user_id == test_user_1.id))).scalars().all()
    assert len(total) == 1


async def test_no_entry_after_last_start(client, db_session, token_user_1):
    now = datetime.now(UTC)
    late = Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - timedelta(minutes=55),
                 ends_at=now + timedelta(minutes=5))
    db_session.add(late)
    await db_session.commit()
    refused = client.post(f"{API}/{late.id}/join", headers=auth(token_user_1))
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "arena_pairing_closed"


async def test_schedule_adds_rating_bands_only_when_enabled(db_session, monkeypatch):
    from src.core.config import settings

    now = datetime(2026, 11, 15, 10, 20, tzinfo=UTC)
    await arena.ensure_schedule(db_session, now)
    assert (await db_session.execute(select(Arena).where(Arena.max_rating.is_not(None)))).scalars().first() is None
    monkeypatch.setattr(settings, "ARENA_RATING_BANDS", True)
    await arena.ensure_schedule(db_session, now)
    bands = (await db_session.execute(select(Arena).where(Arena.max_rating.is_not(None)))).scalars().all()
    assert {a.max_rating for a in bands} == {1300, 1700, 2100}
    assert {a.schedule_key for a in bands if a.conference == "central"} == {
        "central:blitz-3+2-u1300", "central:blitz-3+2-u1700", "central:blitz-3+2-u2100"}
    assert all(a.increment_ms == 2_000 and a.base_time_ms == 180_000 for a in bands)   # группы — только у блица 3+2
