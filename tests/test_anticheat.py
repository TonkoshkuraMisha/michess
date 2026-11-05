# --- FILE: tests/test_anticheat.py ---

import pytest
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.models.user import User
from src.services.anticheat import evaluate_game_telemetry
from src.services.game_state import state_manager


@pytest.mark.asyncio
async def test_human_telemetry_keeps_high_trust_factor(db_session):
    """На серии «человеческих» ходов (разное время, без ухода из вкладки) trust_factor остаётся 100."""
    human = User(username="honest_gm", hashed_password="pw", rating=1850, trust_factor=100, is_cheater=False)
    opponent = User(username="honest_opp", hashed_password="pw", rating=1840, trust_factor=100, is_cheater=False)
    db_session.add_all([human, opponent])
    await db_session.commit()
    await db_session.refresh(human)
    await db_session.refresh(opponent)

    game = Game(
        white_player_id=human.id,
        black_player_id=opponent.id,
        status=GameStatus.COMPLETED,
        is_rated=True,
        result="1-0",
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    human_times = [900, 1400, 3200, 8500, 2100, 14200, 1700, 6400, 950, 11800, 2800, 5100]
    moves = [
        Move(
            game_id=game.id,
            player_id=human.id if idx % 2 == 1 else opponent.id,
            move_number=idx + 4,
            notation="e2e4" if idx % 2 == 1 else "e7e5",
            san="e4" if idx % 2 == 1 else "e5",
            time_taken_ms=t_ms,
            window_blurred_before_move=False,
            is_premove=(idx == 9),
            network_lag_ms=15,
        )
        for idx, t_ms in enumerate(human_times, start=1)
    ]
    db_session.add_all(moves)
    await db_session.commit()

    report = await evaluate_game_telemetry(db_session, game.id)
    await db_session.refresh(human)

    assert report[human.id]["penalty"] == 0
    assert human.trust_factor == 100
    assert human.is_cheater is False


@pytest.mark.asyncio
async def test_robotic_blurred_telemetry_flags_cheater(db_session):
    """Постоянный window_blurred_before_move=True и монотонное время 4500 мс снижают trust_factor < 30."""
    cheater = User(username="tab_switcher_bot", hashed_password="pw", rating=1500, trust_factor=100, is_cheater=False)
    victim = User(username="fair_victim", hashed_password="pw", rating=1500, trust_factor=100, is_cheater=False)
    db_session.add_all([cheater, victim])
    await db_session.commit()
    await db_session.refresh(cheater)
    await db_session.refresh(victim)

    game = Game(
        white_player_id=cheater.id,
        black_player_id=victim.id,
        status=GameStatus.COMPLETED,
        is_rated=True,
        result="1-0",
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    cheater_moves = [
        Move(
            game_id=game.id,
            player_id=cheater.id if move_num % 2 == 1 else victim.id,
            move_number=move_num,
            notation="g1f3" if move_num % 2 == 1 else "g8f6",
            san="Nf3" if move_num % 2 == 1 else "Nf6",
            time_taken_ms=4500,
            window_blurred_before_move=True,
            is_premove=False,
            network_lag_ms=10,
        )
        for move_num in range(1, 16)
    ]
    db_session.add_all(cheater_moves)
    await db_session.commit()

    report = await evaluate_game_telemetry(db_session, game.id)
    await db_session.refresh(cheater)

    assert report[cheater.id]["blur_ratio"] == 1.0
    assert report[cheater.id]["timing_cv"] == 0.0
    assert cheater.trust_factor < 30
    assert cheater.is_cheater is True


@pytest.mark.asyncio
async def test_finish_game_triggers_telemetry_anticheat(db_session):
    """Проверяет автоматический запуск evaluate_game_telemetry внутри state_manager.finish_game."""
    cheater = User(username="auto_ac_cheater", hashed_password="pw", rating=1400, trust_factor=100, is_cheater=False)
    other = User(username="auto_ac_other", hashed_password="pw", rating=1400, trust_factor=100, is_cheater=False)
    db_session.add_all([cheater, other])
    await db_session.commit()
    await db_session.refresh(cheater)
    await db_session.refresh(other)

    game = Game(
        white_player_id=cheater.id,
        black_player_id=other.id,
        status=GameStatus.IN_PROGRESS,
        base_time_ms=180000,
        increment_ms=0,
        is_rated=True,
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    await state_manager.initialize_game(game.id, cheater.id, other.id, 180000, 0)

    # Используем валидную последовательность коротких ходов для построения PGN
    valid_uci_moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3", "g8f6", "b1c3", "d7d6"]
    for idx, uci in enumerate(valid_uci_moves, start=1):
        await state_manager.save_move_telemetry(game.id, {
            "player_id": cheater.id if idx % 2 == 1 else other.id,
            "move_number": idx,
            "notation": uci,
            "san": uci[:2] + "-" + uci[2:],
            "fen_after": "",
            "time_taken_ms": 4500,
            "window_blurred_before_move": True,
            "is_premove": False,
            "network_lag_ms": 5,
        })

    await state_manager.finish_game(db_session, game.id, "1-0", termination="checkmate")
    await db_session.refresh(cheater)

    assert cheater.trust_factor < 30
    assert cheater.is_cheater is True
