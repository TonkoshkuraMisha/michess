# --- FILE: tests/test_arena_swiss.py ---
"""Швейцарка между людьми (таск 17.2): первый тур со свободным, переход тура по завершению партий, конец турнира."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.arena import Arena, ArenaGame, ArenaPlayer
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import arena
from src.services.game_state import state_manager

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def swiss(db_session, test_user_1, test_user_2):
    third = User(username="player3", hashed_password="x", blitz_rating=1100, rapid_rating=1100)
    db_session.add(third)
    now = datetime.now(UTC)
    item = Arena(base_time_ms=600_000, increment_ms=5_000, format="swiss", rounds=2,
                 starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(hours=3))
    db_session.add(item)
    await db_session.commit()
    for user in (test_user_1, test_user_2, third):
        await arena.join(db_session, item, user)
    return item, third


async def _games(db, arena_id: int, rnd: int) -> list[ArenaGame]:
    return list((await db.execute(select(ArenaGame).where(ArenaGame.arena_id == arena_id, ArenaGame.round == rnd))).scalars())


async def test_rounds_with_bye_and_finish(client, db_session, swiss):
    item, third = swiss
    view = client.get(f"{API}/{item.id}").json()
    assert (view["format"], view["current_round"], view["rounds"], view["status"]) == ("swiss", 1, 2, "running")
    first = await _games(db_session, item.id, 1)
    assert len(first) == 1
    paired = {first[0].white_id, first[0].black_id}
    bye = next(p for p in (await db_session.execute(select(ArenaPlayer).where(ArenaPlayer.arena_id == item.id))).scalars()
               if p.user_id not in paired)
    assert (bye.byes, bye.score, bye.games) == (1, 2, 1)

    # Партия тура закончилась обычным путём — составлен второй тур, свободный достаётся другому игроку.
    await state_manager.finish_game(db_session, first[0].game_id, "1-0", termination="resignation")
    await db_session.refresh(item)
    assert item.current_round == 2
    second = await _games(db_session, item.id, 2)
    assert len(second) == 1 and bye.user_id in {second[0].white_id, second[0].black_id}

    # Партия второго тура — настоящая (а не ничья без игры): игроки первого тура уже освободились.
    second_game = await db_session.get(Game, second[0].game_id)
    assert second_game.status == GameStatus.IN_PROGRESS
    await state_manager.finish_game(db_session, second[0].game_id, "1/2-1/2", termination="agreement")
    await db_session.refresh(item)
    assert item.finished_at is not None
    final = client.get(f"{API}/{item.id}").json()
    assert final["status"] == "finished"
    assert sum(s["score"] for s in final["standings"]) == 2 + 2 + 2 + 2   # победа, ничья (1+1), два свободных тура


async def test_play_button_is_only_for_arenas(client, swiss, token_user_1):
    item, _ = swiss
    response = client.post(f"{API}/{item.id}/ready", headers=auth(token_user_1))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "arena_not_running"


async def test_lonely_swiss_ends_without_games(db_session, test_user_1):
    now = datetime.now(UTC)
    item = Arena(base_time_ms=600_000, increment_ms=5_000, format="swiss", rounds=3,
                 starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(hours=3))
    db_session.add(item)
    await db_session.commit()
    await arena.join(db_session, item, test_user_1)
    await arena.advance_swiss(db_session, item)
    assert item.finished_at is not None and arena.status(item) == "finished"
    assert await _games(db_session, item.id, 1) == []


async def test_schedule_has_a_swiss_slot(db_session):
    await arena.ensure_schedule(db_session, datetime(2026, 11, 15, 11, 0, tzinfo=UTC))
    swiss = (await db_session.execute(select(Arena).where(Arena.format == "swiss"))).scalars().all()
    assert swiss and all(s.rounds == 5 and s.increment_ms == 5_000 for s in swiss)
