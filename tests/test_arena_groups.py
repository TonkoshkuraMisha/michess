# --- FILE: tests/test_arena_groups.py ---
"""
Вход в арену и деления. Решение владельца (17.11.2026): никакого деления игроков по силе — в любую арену входит
любой зарегистрированный игрок, закрыт вход только игроку с флагом нечестной игры. Деления (33.2) остаются: это
вместимость одной таблицы, а не отбор.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from src.models.arena import Arena, ArenaPlayer
from src.models.user import User
from src.services import arena
from src.services import arena_schedule as plan

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def blitz(now: datetime, **extra) -> Arena:
    return Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - timedelta(minutes=5),
                 ends_at=now + timedelta(minutes=55), **extra)


async def test_any_registered_player_may_enter(client, db_session, test_user_1, test_user_2, token_user_1,
                                               token_user_2):
    """Новичок без единой партии и сильнейший игрок входят в одну и ту же арену — настоящими запросами клиента."""
    item = blitz(datetime.now(UTC))
    db_session.add(item)
    test_user_1.blitz_rating, test_user_1.blitz_games_played = 700, 0          # только что зарегистрировался
    test_user_2.blitz_rating, test_user_2.blitz_games_played = 2750, 4000      # сильнейший на площадке
    await db_session.commit()

    for token in (token_user_1, token_user_2):
        joined = client.post(f"{API}/{item.id}/join", headers=auth(token))
        assert joined.status_code == 200 and joined.json() == {"joined": True, "arena_id": item.id}
    table = client.get(f"{API}/{item.id}").json()
    assert {row["username"]: row["rating"] for row in table["standings"]} == {"player1": 700, "player2": 2750}
    assert "max_rating" not in table                                            # арен с потолком рейтинга больше нет

    # И они могут встретиться за доской: пара создаётся из тех, кто ждёт.
    assert client.post(f"{API}/{item.id}/ready", headers=auth(token_user_1)).json() == {"waiting": True}
    assert "game_id" in client.post(f"{API}/{item.id}/ready", headers=auth(token_user_2)).json()


async def test_only_the_fair_play_flag_closes_the_entry(client, db_session, test_user_1, token_user_1):
    item = blitz(datetime.now(UTC))
    db_session.add(item)
    test_user_1.is_cheater = True
    await db_session.commit()
    refused = client.post(f"{API}/{item.id}/join", headers=auth(token_user_1))
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "arena_fair_play"
    test_user_1.is_cheater = False
    await db_session.commit()
    assert client.post(f"{API}/{item.id}/join", headers=auth(token_user_1)).status_code == 200
    assert client.post(f"{API}/{item.id}/join").status_code == 401             # без входа — никак


def test_schedule_has_no_rating_restricted_arenas():
    now = datetime(2026, 11, 15, 10, 20, tzinfo=UTC)
    planned = plan.planned(now, timedelta(hours=6))
    assert planned and all(item.schedule_key == f"{item.conference}:{item.slot.key}" for item in planned)
    assert not hasattr(Arena, "max_rating")


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
