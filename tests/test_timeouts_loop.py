# --- FILE: tests/test_timeouts_loop.py ---
"""
Проверка таймаутов изолирует ошибки по партиям: одна «битая» партия не должна останавливать
флаги и отмены во всех остальных (раньше весь проход шёл в одном try и обрывался на ней).
"""

import pytest

from src.services import game_state as game_state_module
from src.services.game_state import (
    GAME_DEADLINES_KEY,
    TIMEOUT_RETRY_BASE_MS,
    TIMEOUT_RETRY_MAX_MS,
    state_manager,
)

NOW = 10_000_000


class DummyManager:
    def __init__(self):
        self.sent: list[tuple[int, dict]] = []

    async def send_personal_message(self, message: dict, user_id: int):
        self.sent.append((user_id, message))

    async def broadcast_to_spectators(self, game_id: int, message: dict):
        pass


class _NoDbSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def finished(monkeypatch) -> list[tuple[int, str, str]]:
    """Подменяет запись итога в БД: тест проверяет цикл, а не finish_game."""
    calls: list[tuple[int, str, str]] = []

    async def fake_finish_game(db, game_id, result, termination="unknown", final_pgn=None):
        calls.append((game_id, result, termination))
        return {"white_delta": 0, "black_delta": 0}

    monkeypatch.setattr(state_manager, "finish_game", fake_finish_game)
    monkeypatch.setattr(game_state_module, "AsyncSessionLocal", _NoDbSession)
    monkeypatch.setattr(state_manager, "_timeout_failures", {})
    return calls


async def _flagged_game(game_id: int, white_id: int, black_id: int) -> None:
    """Партия, где у белых (их ход) кончилось время."""
    await state_manager.initialize_game(game_id, white_id, black_id, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(game_id, {
        "state_version": "4", "white_time_ms": "1000", "last_move_at": str(NOW - 5000),
    })
    # update_game_state не трогает дедлайн (производственный код меняет им только draw/rematch
    # offer) — тест правит время вручную, поэтому сам переставляет дедлайн на реальный флаг.
    await state_manager.redis.zadd(GAME_DEADLINES_KEY, {str(game_id): NOW - 4000})


async def _broken_game(game_id: int) -> None:
    await state_manager.initialize_game(game_id, 1, 2, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(game_id, {"state_version": "4", "white_id": "broken"})
    await state_manager.redis.zadd(GAME_DEADLINES_KEY, {str(game_id): NOW})


async def test_broken_game_does_not_block_flags_in_other_games(finished):
    await _broken_game(91)
    await _flagged_game(92, 10, 20)

    manager = DummyManager()
    await state_manager.check_timeouts_once(manager, now_ms=NOW)

    assert finished == [(92, "0-1", "timeout")]
    assert {uid for uid, msg in manager.sent if msg["event"] == "game_over"} == {10, 20}
    assert state_manager._timeout_failures[91][0] == 1


async def test_failing_game_is_retried_with_backoff_and_recovers(finished):
    await _broken_game(93)
    manager = DummyManager()

    await state_manager.check_timeouts_once(manager, now_ms=NOW)
    assert state_manager._timeout_failures[93] == (1, NOW + TIMEOUT_RETRY_BASE_MS)

    # Состояние починили (или сбой БД прошёл), и у белых тем временем упал флаг.
    await state_manager.update_game_state(93, {
        "white_id": "1", "white_time_ms": "1000", "last_move_at": str(NOW - 5000),
    })

    await state_manager.check_timeouts_once(manager, now_ms=NOW + TIMEOUT_RETRY_BASE_MS // 2)
    assert finished == []  # пауза ещё не прошла — партию не трогаем

    await state_manager.check_timeouts_once(manager, now_ms=NOW + TIMEOUT_RETRY_BASE_MS)
    assert finished == [(93, "0-1", "timeout")]
    assert 93 not in state_manager._timeout_failures


async def test_backoff_grows_and_is_capped(finished):
    for _ in range(12):
        state_manager._record_timeout_failure(94, NOW)
    count, retry_at = state_manager._timeout_failures[94]
    assert count == 12
    assert retry_at == NOW + TIMEOUT_RETRY_MAX_MS


async def test_broken_game_stays_active_for_later_retries(finished):
    """Партия с ошибкой не выбрасывается: при временном сбое БД иначе потерялись бы все партии."""
    await _broken_game(95)
    await state_manager.check_timeouts_once(DummyManager(), now_ms=NOW)
    assert "95" in await state_manager.redis.smembers("active_games")


async def test_malformed_active_game_id_is_removed(finished):
    await state_manager.redis.zadd(GAME_DEADLINES_KEY, {"not-a-number": NOW})
    await _flagged_game(96, 30, 40)

    await state_manager.check_timeouts_once(DummyManager(), now_ms=NOW)

    assert "not-a-number" not in await state_manager.redis.zrangebyscore(GAME_DEADLINES_KEY, "-inf", "+inf")
    assert finished == [(96, "0-1", "timeout")]


async def test_failure_counters_of_finished_games_are_dropped(finished):
    state_manager._timeout_failures[97] = (3, NOW + 5000)  # партии 97 среди активных уже нет
    await state_manager.check_timeouts_once(DummyManager(), now_ms=NOW)
    assert 97 not in state_manager._timeout_failures


async def test_games_far_from_deadline_are_not_touched(finished):
    """
    Партия с дедлайном далеко в будущем не должна обрабатываться — в этом и смысл перехода
    с полного перебора active_games на ZRANGEBYSCORE по GAME_DEADLINES_KEY. Состояние этой
    партии «битое» (упало бы при реальной попытке проверки) — если цикл её тронет, тест
    это заметит по счётчику сбоев.
    """
    await state_manager.initialize_game(98, 1, 2, base_time_ms=600000, increment_ms=0)
    await state_manager.update_game_state(98, {"white_id": "broken"})
    await state_manager.redis.zadd(GAME_DEADLINES_KEY, {"98": NOW + 600000})

    await state_manager.check_timeouts_once(DummyManager(), now_ms=NOW)

    assert finished == []
    assert 98 not in state_manager._timeout_failures
