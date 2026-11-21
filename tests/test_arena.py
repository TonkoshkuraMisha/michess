# --- FILE: tests/test_arena.py ---
"""Арены (таск 17.2): расписание, вход, пара из ожидающих, очки и «огонь», итог партии через обычное завершение."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from src.models.arena import Arena, ArenaGame
from src.services import arena
from src.services.game_state import state_manager

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def running(db_session):
    now = datetime.now(UTC)
    item = Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - timedelta(minutes=5),
                 ends_at=now + timedelta(minutes=40))
    db_session.add(item)
    await db_session.commit()
    return item


def test_points_and_fire():
    assert [arena.points(s, 0) for s in (1.0, 0.5, 0.0)] == [2, 1, 0]
    assert [arena.points(s, arena.FIRE_AFTER) for s in (1.0, 0.5, 0.0)] == [4, 2, 0]


async def test_schedule_is_created_once(db_session):
    now = datetime(2026, 11, 15, 10, 20, tzinfo=UTC)
    await arena.ensure_schedule(db_session, now)
    first = await db_session.scalar(select(func.count()).select_from(Arena))
    await arena.ensure_schedule(db_session, now)
    assert await db_session.scalar(select(func.count()).select_from(Arena)) == first > 0
    query = select(Arena).where(Arena.schedule_key == "central:blitz-3+2").order_by(Arena.starts_at)
    blitz = (await db_session.execute(query)).scalars().all()
    assert arena.status(blitz[0], now) == "running"           # началась в 12:00 по Киеву (10:00 UTC), идёт час
    assert all(b.increment_ms == 2_000 for b in blitz)


async def test_pairing_and_scores(client, db_session, running, test_user_1, test_user_2, token_user_1, token_user_2):
    assert client.post(f"{API}/{running.id}/ready", headers=auth(token_user_1)).json()["detail"]["code"] == "arena_not_joined"
    for token in (token_user_1, token_user_2):
        assert client.post(f"{API}/{running.id}/join", headers=auth(token)).status_code == 200
    assert client.post(f"{API}/{running.id}/ready", headers=auth(token_user_1)).json() == {"waiting": True}
    view = client.get(f"{API}/{running.id}", headers=auth(token_user_1)).json()
    assert view["me"] == {"username": test_user_1.username, "joined": True, "waiting": True, "current_game_id": None,
                          "division_arena_id": None, "reminder": False, "podium_place": None}

    started = client.post(f"{API}/{running.id}/ready", headers=auth(token_user_2)).json()
    game_id = started["game_id"]
    assert client.get(f"{API}/{running.id}", headers=auth(token_user_1)).json()["me"]["current_game_id"] == game_id
    # Страница первого игрока ещё повторяет «Играть»: он уже в партии — получает её, а не новое ожидание (иначе третий
    # игрок получил бы в пару занятого соперника).
    assert client.post(f"{API}/{running.id}/ready", headers=auth(token_user_1)).json() == {"game_id": game_id}
    assert await arena.waiting_ids(running.id) == set()
    record = (await db_session.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one()

    # Обычное завершение партии засчитывает её в арене.
    await state_manager.finish_game(db_session, game_id, "1-0", termination="resignation")
    await db_session.refresh(record)
    assert (record.result, record.white_points, record.black_points) == ("1-0", 2, 0)
    table = client.get(f"{API}/{running.id}").json()["standings"]
    winner = "player1" if record.white_id == test_user_1.id else "player2"
    assert table[0]["username"] == winner and table[0]["score"] == 2 and table[1]["score"] == 0


async def test_fire_doubles_after_two_wins(db_session, running, test_user_1, test_user_2):
    for user in (test_user_1, test_user_2):
        await arena.join(db_session, running, user)
    from src.models.game import Game, GameStatus
    for _ in range(3):
        game = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED)
        db_session.add(game)
        await db_session.flush()
        db_session.add(ArenaGame(arena_id=running.id, game_id=game.id, white_id=test_user_1.id, black_id=test_user_2.id))
        await db_session.flush()
        await arena.on_game_finished(db_session, game.id, "1-0")
    await db_session.commit()
    table = await arena.standings(db_session, running.id)
    assert (table[0]["score"], table[0]["wins"], table[0]["fire"]) == (2 + 2 + 4, 3, True)
    assert await arena.on_game_finished(db_session, 999_999, "1-0") is False


async def test_finished_arena_rejects_join_and_play(client, db_session, token_user_1):
    now = datetime.now(UTC)
    over = Arena(base_time_ms=60_000, increment_ms=0, starts_at=now - timedelta(hours=2), ends_at=now - timedelta(hours=1))
    soon = Arena(base_time_ms=60_000, increment_ms=0, starts_at=now + timedelta(hours=1), ends_at=now + timedelta(hours=2))
    db_session.add_all([over, soon])
    await db_session.commit()
    assert client.post(f"{API}/{over.id}/join", headers=auth(token_user_1)).json()["detail"]["code"] == "arena_finished"
    assert client.post(f"{API}/{soon.id}/join", headers=auth(token_user_1)).status_code == 200
    assert client.post(f"{API}/{soon.id}/ready", headers=auth(token_user_1)).json()["detail"]["code"] == "arena_not_running"
    assert client.get(f"{API}/424242").status_code == 404


def test_list_and_current(client):
    arenas = client.get(API).json()["arenas"]
    assert arenas and {a["status"] for a in arenas} <= {"running", "closing", "scheduled", "finished"}
    current = client.get(f"{API}/current").json()["arena"]
    assert current is not None and current["status"] in ("running", "closing", "scheduled")
