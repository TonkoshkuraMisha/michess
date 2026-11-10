# --- FILE: tests/test_disconnect_clock.py ---
"""
Разрыв соединения: часы при переподключении, флаг и брошенная партия у отключённого игрока,
несколько вкладок одного пользователя и гонка «перезагрузка страницы».
"""

import time

from src.services.connection_manager import ConnectionManager
from src.services.game_state import ABANDON_TIMEOUT_MS, evaluate_clock_expiry, state_manager


class DummyManager:
    def __init__(self):
        self.sent: list[tuple[int, dict]] = []

    async def send_personal_message(self, message: dict, user_id: int):
        self.sent.append((user_id, message))


class DummySocket:
    async def accept(self):
        pass

    async def send_text(self, text: str):
        pass


def _state(now: int, **overrides) -> dict:
    state = {
        "white_id": 1, "black_id": 2, "turn": "white",
        "white_time_ms": 60000, "black_time_ms": 60000, "last_move_at": now,
        "white_disconnected": "false", "black_disconnected": "false",
        "white_disconnect_started_at": 0, "black_disconnect_started_at": 0,
    }
    state.update(overrides)
    return state


async def test_reconnect_during_opponent_turn_does_not_give_opponent_time():
    """Раньше last_move_at сдвигался на время офлайна, и часы соперника стояли всё это время."""
    await state_manager.initialize_game(game_id=31, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
    now = int(time.time() * 1000)
    # Ход белых; чёрные отключились 20 секунд назад.
    await state_manager.update_game_state(31, {
        "last_move_at": now - 30000,
        "black_disconnected": "true",
        "black_disconnect_started_at": now - 20000,
    })

    await state_manager.handle_player_reconnect(20, DummyManager())

    state = await state_manager.get_game_state(31)
    assert state["black_disconnected"] == "false"
    assert state["last_move_at"] == now - 30000
    assert state["white_time_ms"] == 60000


def test_disconnected_player_flags_counting_time_before_disconnect():
    """Время между последним ходом и разрывом тоже идёт в зачёт (раньше терялось)."""
    now = int(time.time() * 1000)
    state = _state(
        now,
        white_time_ms=8000, last_move_at=now - 10000,
        white_disconnected="true", white_disconnect_started_at=now - 3000,
    )
    assert evaluate_clock_expiry(state, now) == ("0-1", 2, "timeout")


def test_abandon_timer_ignores_stopped_clock_on_opponent_turn():
    """
    Если сейчас ход соперника, часы отключённого стоят: при 5 секундах на часах он не должен
    проигрывать через 5 секунд офлайна — только по общему таймеру брошенной партии.
    """
    now = int(time.time() * 1000)
    state = _state(now, black_time_ms=5000, black_disconnected="true", black_disconnect_started_at=now - 10000)
    assert evaluate_clock_expiry(state, now) is None

    abandoned = {**state, "black_disconnect_started_at": now - ABANDON_TIMEOUT_MS}
    assert evaluate_clock_expiry(abandoned, now) == ("1-0", 1, "abandoned")


async def test_opponent_gets_wait_limited_by_live_clock():
    await state_manager.initialize_game(game_id=32, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
    now = int(time.time() * 1000)
    await state_manager.update_game_state(32, {"last_move_at": now - 50000})

    manager = DummyManager()
    await state_manager.handle_player_disconnect(10, manager)

    (recipient, message), = manager.sent
    assert recipient == 20
    assert 9000 <= message["max_wait_ms"] <= 10000


async def test_disconnect_flag_not_written_after_game_finished():
    """Флаг отключения не пишется в партию, которая уже не идёт."""
    await state_manager.initialize_game(game_id=33, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
    await state_manager.update_game_state(33, {"status": "completed"})

    await state_manager.handle_player_disconnect(10, DummyManager())

    state = await state_manager.redis.hgetall("game:33:state")
    assert state.get("white_disconnected") == "false"


class _NoDbSession:
    """Сессия-заглушка: тест проверяет жизненный цикл соединений, БД ему не нужна.
    (Настоящая сессия из event loop TestClient ломает общее SQLite-соединение тестов.)"""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, *args, **kwargs):
        return None


async def test_closing_one_tab_keeps_player_online(client, monkeypatch):
    from src.api.deps import get_current_user_ws
    from src.db.session import get_session_factory
    from src.main import app
    from src.models.user import User

    player = User(id=501, username="multitab", bullet_rating=1500, blitz_rating=1500, rapid_rating=1500, classical_rating=1500)

    async def _user():
        return player


    monkeypatch.setitem(app.dependency_overrides, get_current_user_ws, _user)
    monkeypatch.setitem(app.dependency_overrides, get_session_factory, lambda: _NoDbSession)

    await state_manager.initialize_game(game_id=34, white_id=501, black_id=502, base_time_ms=60000, increment_ms=0)
    url = "/api/v1/ws/matchmaking?ticket=unused"

    with client.websocket_connect(url) as tab2:
        with client.websocket_connect(url):
            pass  # первая вкладка закрыта

        state = await state_manager.get_game_state(34)
        assert state["white_disconnected"] == "false"
        tab2.send_json({"action": "leave_queue"})
        assert any(tab2.receive_json()["event"] == "queue_left" for _ in range(5))

    state = await state_manager.get_game_state(34)
    assert state["white_disconnected"] == "true"  # закрыта последняя вкладка


async def test_reload_race_does_not_leave_player_marked_disconnected(monkeypatch):
    """
    Перезагрузка страницы: новая вкладка подключается (и выполняет handle_player_reconnect,
    который ничего не делает), пока старая ещё обрабатывает разрыв и только потом ставит флаг.
    """
    await state_manager.initialize_game(game_id=35, white_id=10, black_id=20, base_time_ms=60000, increment_ms=0)
    cm = ConnectionManager()
    old_tab, new_tab = DummySocket(), DummySocket()
    await cm.connect(old_tab, user_id=10)

    original_disconnect_handler = state_manager.handle_player_disconnect

    async def reconnect_then_mark(user_id, manager):
        await cm.connect(new_tab, user_id=10)  # новая вкладка успела подключиться
        await original_disconnect_handler(user_id, manager)

    monkeypatch.setattr(state_manager, "handle_player_disconnect", reconnect_then_mark)
    await cm.disconnect(10, old_tab)

    state = await state_manager.get_game_state(35)
    assert state["white_disconnected"] == "false"
    assert cm._has_open_sockets(10)
