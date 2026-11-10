# --- FILE: tests/test_multiworker.py ---
"""
Несколько воркеров и вкладок: присутствие, доставка сообщений и зрители через Redis,
лидерство цикла таймаутов, атомарное принятие вызова. Плюс флаг по правилу ФИДЕ 6.9.
"""

import asyncio
import json
import time

import fakeredis
import fakeredis.aioredis
import pytest

from src.services import game_state as game_state_module
from src.services.connection_manager import ConnectionManager
from src.services.game_state import FLAG_DRAW_TERMINATION, evaluate_clock_expiry, flag_outcome, state_manager


class RecordingSocket:
    def __init__(self):
        self.received: list[dict] = []

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.received.append(json.loads(text))


# --- Флаг по правилу ФИДЕ 6.9 -----------------------------------------------------------

@pytest.mark.parametrize(
    "fen, flagged, expected",
    [
        # У чёрных (победителя по флагу) только конь против голого короля — мат невозможен.
        ("8/8/8/4k3/8/8/2n5/K7 w - - 0 60", "white", ("1/2-1/2", FLAG_DRAW_TERMINATION)),
        # Голый король у победителя.
        ("8/8/8/4k3/8/8/2q5/K7 b - - 0 60", "black", ("1/2-1/2", FLAG_DRAW_TERMINATION)),
        # Ладья у победителя — обычное поражение по времени.
        ("8/8/8/4k3/8/8/2r5/K7 w - - 0 60", "white", ("0-1", "timeout")),
        # Конь против ладьи: кооперативный мат существует, значит, победа.
        ("8/8/8/4k3/8/8/2n5/KR6 w - - 0 60", "white", ("0-1", "timeout")),
        # Одноцветные слоны у обоих: мат невозможен.
        ("8/8/8/4k3/2b5/8/8/K2B4 w - - 0 60", "white", ("1/2-1/2", FLAG_DRAW_TERMINATION)),
    ],
)
def test_flag_outcome_follows_fide(fen, flagged, expected):
    assert flag_outcome(fen, flagged) == expected


def test_clock_expiry_draw_has_no_winner():
    now = int(time.time() * 1000)
    state = {
        "white_id": 1, "black_id": 2, "turn": "white", "board_fen": "8/8/8/4k3/8/8/2n5/K7 w - - 0 60",
        "white_time_ms": 1000, "black_time_ms": 5000, "last_move_at": now - 2000,
        "white_disconnected": "false", "black_disconnected": "false",
    }
    assert evaluate_clock_expiry(state, now) == ("1/2-1/2", None, FLAG_DRAW_TERMINATION)


async def test_flag_during_move_attempt_is_draw_vs_insufficient_material():
    await state_manager.initialize_game(game_id=41, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(41, {
        "board_fen": "8/8/8/4k3/8/8/2n5/K7 w - - 0 60",
        "last_move_at": int(time.time() * 1000) - 70000,
    })

    res = await state_manager.process_atomic_move(41, 10, "cmd-flag", "a1b1")

    assert res["status"] == "game_over"
    assert res["result"] == "1/2-1/2"
    assert res["termination"] == FLAG_DRAW_TERMINATION


# --- Два воркера на общем Redis ---------------------------------------------------------

@pytest.fixture
def shared_redis(monkeypatch):
    server = fakeredis.FakeServer()
    client = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    monkeypatch.setattr(state_manager, "redis", client)
    monkeypatch.setattr("src.db.redis.redis_client", client)
    return client


def _worker(client, worker_id: str) -> ConnectionManager:
    cm = ConnectionManager()
    cm.worker_id = worker_id
    cm.redis = client
    cm.pubsub = client.pubsub()
    return cm


async def _stop(*managers: ConnectionManager):
    for cm in managers:
        for task in (cm._listener_task, cm._heartbeat_task):
            if task is not None:
                task.cancel()
        await asyncio.gather(
            *(t for t in (cm._listener_task, cm._heartbeat_task) if t is not None), return_exceptions=True,
        )
        await cm.pubsub.aclose()


async def _wait_for(predicate, timeout_s: float = 3.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_tab_on_other_worker_keeps_player_online(shared_redis):
    worker_a, worker_b = _worker(shared_redis, "A"), _worker(shared_redis, "B")
    try:
        await state_manager.initialize_game(game_id=42, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
        tab_a, tab_b = RecordingSocket(), RecordingSocket()
        await worker_a.connect(tab_a, user_id=10)
        await worker_b.connect(tab_b, user_id=10)

        await worker_a.disconnect(10, tab_a)
        state = await state_manager.get_game_state(42)
        assert state["white_disconnected"] == "false"

        await worker_b.disconnect(10, tab_b)
        state = await state_manager.get_game_state(42)
        assert state["white_disconnected"] == "true"
    finally:
        await _stop(worker_a, worker_b)


async def test_message_reaches_tabs_on_all_workers_without_duplicates(shared_redis):
    worker_a, worker_b = _worker(shared_redis, "A"), _worker(shared_redis, "B")
    try:
        tab_a, tab_b = RecordingSocket(), RecordingSocket()
        await worker_a.connect(tab_a, user_id=77)
        await worker_b.connect(tab_b, user_id=77)

        await worker_a.send_personal_message({"event": "move_made", "san": "e4"}, 77)

        assert await _wait_for(lambda: tab_b.received)
        await asyncio.sleep(0.2)  # даём шанс прийти дублю, если он есть
        assert [m["san"] for m in tab_a.received] == ["e4"]
        assert [m["san"] for m in tab_b.received] == ["e4"]
    finally:
        await _stop(worker_a, worker_b)


async def test_stale_presence_of_crashed_worker_expires(shared_redis):
    worker = _worker(shared_redis, "A")
    try:
        await shared_redis.zadd("presence:user:88", {"conn-from-dead-worker": int(time.time() * 1000) - 60_000})
        assert await worker.is_user_online(88) is False
    finally:
        await _stop(worker)


async def test_spectators_are_shared_between_workers():
    worker_a, worker_b = ConnectionManager(), ConnectionManager()

    await worker_a.add_spectator(500, 33)
    assert await worker_b.get_spectator_ids(500) == {33}

    await worker_b.add_spectator(501, 33)  # перешёл смотреть другую партию
    assert await worker_a.get_spectator_ids(500) == set()
    assert await worker_a.get_spectator_ids(501) == {33}

    await worker_a.remove_user_from_all_spectating(33)
    assert await worker_b.get_spectator_ids(501) == set()


async def test_only_one_worker_runs_timeouts_loop(monkeypatch):
    monkeypatch.setattr(game_state_module, "WORKER_ID", "A")
    assert await state_manager._hold_timeouts_leadership() is True
    assert await state_manager._hold_timeouts_leadership() is True  # лидер продлевает

    monkeypatch.setattr(game_state_module, "WORKER_ID", "B")
    assert await state_manager._hold_timeouts_leadership() is False

    await state_manager.redis.delete(game_state_module.TIMEOUTS_LEADER_KEY)  # лидер упал, TTL истёк
    assert await state_manager._hold_timeouts_leadership() is True


async def test_challenge_accepted_once_across_workers(monkeypatch):
    from src.services.matchmaker import matchmaker

    created: list[tuple[int, int]] = []

    async def fake_create(session, c_id, a_id, base_time, inc_time, now_ms):
        created.append((c_id, a_id))
        return {
            "game_id": 900 + len(created), "white_id": c_id, "black_id": a_id,
            "white_username": "c", "white_rating": 1500, "black_username": "a", "black_rating": 1500,
        }

    class _Silent:
        async def send_personal_message(self, message, user_id):
            pass

    monkeypatch.setattr(matchmaker, "_create_match_record", fake_create)
    await matchmaker.join_queue(1, "challenger", 1500, 180000, 0, 0, 3000)

    results = await asyncio.gather(
        matchmaker.accept_challenge(1, 2, _Silent(), state_manager, db=object()),
        matchmaker.accept_challenge(1, 3, _Silent(), state_manager, db=object()),
    )

    assert len(created) == 1
    assert sum(r is not None for r in results) == 1
