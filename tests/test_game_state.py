import pytest
import time
from src.services.game_state import state_manager


class DummyManager:
    """Заглушка WebSocket-менеджера для изоляции тестов логики состояний."""
    async def send_personal_message(self, message: dict, user_id: int):
        pass


@pytest.mark.asyncio
async def test_game_state_initialization():
    await state_manager.initialize_game(
        game_id=1, white_id=10, black_id=20, base_time_ms=180000, increment_ms=0
    )
    state = await state_manager.get_game_state(1)

    assert state is not None
    assert state["white_id"] == 10
    assert state["black_id"] == 20
    assert state["white_time_ms"] == 180000
    assert state["status"] == "in_progress"


@pytest.mark.asyncio
async def test_disconnect_and_reconnect_time_deduction():
    await state_manager.initialize_game(
        game_id=2, white_id=10, black_id=20, base_time_ms=180000, increment_ms=0
    )

    dummy_manager = DummyManager()

    # Эмулируем дисконект белых (ход белых)
    await state_manager.handle_player_disconnect(10, dummy_manager)

    state_after_dc = await state_manager.get_game_state(2)
    assert state_after_dc["white_disconnected"] == "true"

    # Искусственно состарим время начала дисконекта на 5 секунд (5000 мс)
    old_dc_time = int(state_after_dc["white_disconnect_started_at"]) - 5000
    await state_manager.update_game_state(2, {"white_disconnect_started_at": old_dc_time})

    # Эмулируем переподключение
    await state_manager.handle_player_reconnect(10, dummy_manager)

    state_after_reconnect = await state_manager.get_game_state(2)
    assert state_after_reconnect["white_disconnected"] == "false"
    # Время должно уменьшиться примерно на 5 секунд (180000 - 5000 = 175000)
    assert state_after_reconnect["white_time_ms"] <= 175000