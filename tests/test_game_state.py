# --- FILE: tests/test_game_state.py ---

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


@pytest.mark.asyncio
async def test_abort_game_without_rating_change(db_session):
    """Проверяет, что отмена партии на 1-м ходу (до 2 полуходов) не меняет рейтинг и ставит статус ABORTED."""
    from src.models.user import User
    from src.models.game import Game, GameStatus
    from src.services.game_state import state_manager

    u1 = User(username="abort_white_player", hashed_password="pw", rating=1500)
    u2 = User(username="abort_black_player", hashed_password="pw", rating=1500)
    db_session.add_all([u1, u2])
    await db_session.commit()
    await db_session.refresh(u1)
    await db_session.refresh(u2)

    game = Game(
        white_player_id=u1.id,
        black_player_id=u2.id,
        status=GameStatus.IN_PROGRESS,
        base_time_ms=180000,
        increment_ms=2000,
        is_rated=True,
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    await state_manager.redis.hset(f"game:{game.id}:state", mapping={
        "white_id": str(u1.id),
        "black_id": str(u2.id),
        "status": "in_progress",
        "state_version": "1",
        "last_move_at": "1000",
    })

    res = await state_manager.abort_game(db_session, game.id)
    assert res["status"] == "aborted"
    assert res["result"] == "*"
    assert res["white_delta"] == 0
    assert res["black_delta"] == 0

    await db_session.refresh(u1)
    await db_session.refresh(u2)
    await db_session.refresh(game)
    assert u1.rating == 1500
    assert u2.rating == 1500
    assert game.status == GameStatus.ABORTED


@pytest.mark.asyncio
async def test_private_invite_create_and_redeem():
    """Проверяет создание приватного вызова по ссылке в Redis и его одноразовое погашение."""
    from src.services.matchmaker import matchmaker

    invite = await matchmaker.create_private_invite(
        user_id=101,
        username="teacher_misha",
        rating=2050,
        base_time_ms=600000,
        increment_ms=5000,
        color_pref="white",
    )
    code = invite["code"]
    assert len(code) >= 6

    # Создатель не может принять собственный вызов
    self_accept = await matchmaker.accept_private_invite(code, acceptor_id=101)
    assert self_accept is None

    # Второй игрок успешно принимает вызов
    redeemed = await matchmaker.accept_private_invite(code, acceptor_id=202)
    assert redeemed is not None
    assert redeemed["white_id"] == 101
    assert redeemed["black_id"] == 202
    assert redeemed["base_time_ms"] == 600000
    assert redeemed["increment_ms"] == 5000

    # Повторное погашение того же кода невозможно
    second_try = await matchmaker.accept_private_invite(code, acceptor_id=303)
    assert second_try is None
