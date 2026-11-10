# --- FILE: tests/test_game_end_atomicity.py ---
"""
Атомарность завершения партии: из конкурентных претендентов (сдача, ничья, флаг, отмена)
партию завершает ровно один, а рейтинг начисляется ровно один раз.
"""

import asyncio
import time

import fakeredis.aioredis
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.game_state import state_manager, evaluate_clock_expiry


@pytest.fixture
def real_redis(monkeypatch):
    """fakeredis с настоящей семантикой WATCH/MULTI (самодельный мок её не эмулирует)."""
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(state_manager, "redis", client)
    return client


async def _make_game(db_session, *, rated: bool = True) -> tuple[Game, User, User]:
    white = User(username="w_atomic", hashed_password="pw", rating=1500)
    black = User(username="b_atomic", hashed_password="pw", rating=1500)
    db_session.add_all([white, black])
    await db_session.commit()
    game = Game(
        white_player_id=white.id,
        black_player_id=black.id,
        status=GameStatus.IN_PROGRESS,
        base_time_ms=180000,
        increment_ms=0,
        is_rated=rated,
    )
    db_session.add(game)
    await db_session.commit()
    await state_manager.initialize_game(game.id, white.id, black.id, 180000, 0)
    return game, white, black


async def test_concurrent_claims_have_single_winner(real_redis, db_session):
    game, _, _ = await _make_game(db_session)

    claims = await asyncio.gather(
        state_manager.claim_game_end(game.id, "0-1", "resignation"),
        state_manager.claim_game_end(game.id, "1-0", "resignation"),
        state_manager.claim_game_end(game.id, "1/2-1/2", "agreement"),
        state_manager.claim_game_end(game.id, "0-1", "timeout"),
        state_manager.claim_game_end(game.id, "*", "aborted", status="aborted"),
    )

    assert sum(c is not None for c in claims) == 1
    state = await real_redis.hgetall(f"game:{game.id}:state")
    assert state["status"] in ("completed", "aborted")


async def test_claim_guard_is_rechecked(real_redis, db_session):
    game, _, _ = await _make_game(db_session)

    assert await state_manager.claim_game_end(game.id, "1/2-1/2", "agreement", guard=lambda s: False) is None
    state = await real_redis.hgetall(f"game:{game.id}:state")
    assert state["status"] == "in_progress"


async def test_flag_inside_move_blocks_second_finisher(real_redis, db_session):
    """Флаг при попытке хода сразу фиксируется в Redis: цикл таймаутов и сдача уже не завершат партию."""
    game, white, _ = await _make_game(db_session)
    await state_manager.update_game_state(game.id, {"last_move_at": int(time.time() * 1000) - 200_000})

    res = await state_manager.process_atomic_move(game.id, white.id, "cmd-1", "e2e4")
    assert res["status"] == "game_over"
    assert res["termination"] == "timeout"

    state = await real_redis.hgetall(f"game:{game.id}:state")
    assert state["status"] == "completed"
    assert await state_manager.claim_game_end(game.id, "0-1", "timeout") is None


async def test_finish_game_with_stale_session_does_not_double_rate(real_redis, db_session):
    """
    Сессия WS-обработчика долгоживущая (expire_on_commit=False) и может держать устаревший
    объект Game со статусом IN_PROGRESS. finish_game обязан перечитать строку из БД.
    """
    game, white, black = await _make_game(db_session)
    # Фабрика на том же тестовом движке (импортировать conftest напрямую нельзя: это создаст его копию).
    TestSessionLocal = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async with TestSessionLocal() as stale_session:
        stale_game = await stale_session.get(Game, game.id)
        assert stale_game.status == GameStatus.IN_PROGRESS  # объект закэширован в identity map

        async with TestSessionLocal() as other_session:
            first = await state_manager.finish_game(other_session, game.id, "1-0", termination="resignation")
        assert first["white_delta"] > 0

        second = await state_manager.finish_game(stale_session, game.id, "1-0", termination="resignation")
        assert second["white_delta"] == first["white_delta"]

    async with TestSessionLocal() as check:
        w = await check.get(User, white.id)
        b = await check.get(User, black.id)
        assert w.rating == 1500 + first["white_delta"]
        assert b.rating == 1500 + first["black_delta"]


def test_evaluate_clock_expiry():
    now = int(time.time() * 1000)
    base = {
        "white_id": 1, "black_id": 2, "turn": "white",
        "white_time_ms": 1000, "black_time_ms": 5000, "last_move_at": now - 500,
        "white_disconnected": "false", "black_disconnected": "false",
        "white_disconnect_started_at": 0, "black_disconnect_started_at": 0,
    }
    assert evaluate_clock_expiry(base, now) is None
    assert evaluate_clock_expiry({**base, "last_move_at": now - 1500}, now) == ("0-1", 2, "timeout")
    abandoned = {**base, "black_disconnected": "true", "black_disconnect_started_at": now - 6000}
    assert evaluate_clock_expiry(abandoned, now) == ("1-0", 1, "abandoned")
