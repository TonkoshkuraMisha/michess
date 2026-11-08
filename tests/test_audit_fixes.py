# --- FILE: tests/test_audit_fixes.py ---

import asyncio
import chess
import pytest

from src.api.bots import calculate_authentic_thinking_time_ms
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.models.user import User
from src.services.anticheat import evaluate_game_telemetry
from src.services.game_state import state_manager
from src.services.matchmaker import matchmaker


def test_opening_book_source_recognized_in_thinking_time():
    """Проверяет, что source='opening_book' из HistoricalBot.choose_move распознаётся как книжный ход."""
    board = chess.Board()
    for _ in range(20):
        ms = calculate_authentic_thinking_time_ms("morphy", board, "e2e4", "opening_book")
        assert 200 <= ms <= 600


@pytest.mark.asyncio
async def test_anticheat_idempotency_prevents_double_penalty(db_session):
    """Повторный вызов evaluate_game_telemetry для одной и той же партии не штрафует игрока дважды."""
    u1 = User(username="moderate_blur_user", hashed_password="pw", rating=1500, trust_factor=100, is_cheater=False)
    u2 = User(username="clean_opp", hashed_password="pw", rating=1500, trust_factor=100, is_cheater=False)
    db_session.add_all([u1, u2])
    await db_session.commit()
    await db_session.refresh(u1)
    await db_session.refresh(u2)

    game = Game(
        white_player_id=u1.id,
        black_player_id=u2.id,
        status=GameStatus.COMPLETED,
        is_rated=True,
        result="1-0",
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    moves = [
        Move(
            game_id=game.id,
            player_id=u1.id,
            move_number=idx + 8,
            notation="g1f3",
            san="Nf3",
            time_taken_ms=1000 + idx * 900,
            window_blurred_before_move=(idx % 2 == 0),
            is_premove=False,
            network_lag_ms=10,
        )
        for idx in range(1, 9)
    ]
    db_session.add_all(moves)
    await db_session.commit()

    await evaluate_game_telemetry(db_session, game.id)
    await db_session.refresh(u1)
    trust_after_first = u1.trust_factor
    assert trust_after_first < 100

    # Повторный вызов для той же партии не должен уменьшать trust_factor ещё раз
    await evaluate_game_telemetry(db_session, game.id)
    await db_session.refresh(u1)
    assert u1.trust_factor == trust_after_first


@pytest.mark.asyncio
async def test_fide_dynamic_k_factor_for_new_player(db_session):
    """Новый игрок (< 30 партий) получает K=40 (+20 при победе над равным соперником)."""
    newbie = User(username="newbie_k40", hashed_password="pw", rating=1200)
    opponent = User(username="opp_k40", hashed_password="pw", rating=1200)
    db_session.add_all([newbie, opponent])
    await db_session.commit()
    await db_session.refresh(newbie)
    await db_session.refresh(opponent)

    game = Game(
        white_player_id=newbie.id,
        black_player_id=opponent.id,
        status=GameStatus.IN_PROGRESS,
        base_time_ms=180000,
        increment_ms=0,
        is_rated=True,
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)

    await state_manager.initialize_game(game.id, newbie.id, opponent.id, 180000, 0)
    res = await state_manager.finish_game(db_session, game.id, "1-0", termination="checkmate")

    assert res["white_delta"] == 20
    assert res["black_delta"] == -20
    assert res["white_new_rating"] == 1220


@pytest.mark.asyncio
async def test_concurrent_private_invite_redemption_is_atomic():
    """При одновременном принятии приватной ссылки двумя игроками срабатывает ровно один вызов."""
    invite = await matchmaker.create_private_invite(
        user_id=500,
        username="host_player",
        rating=1600,
        base_time_ms=180000,
        increment_ms=2000,
        color_pref="white",
    )
    code = invite["code"]

    r1, r2 = await asyncio.gather(
        matchmaker.accept_private_invite(code, acceptor_id=501),
        matchmaker.accept_private_invite(code, acceptor_id=502),
    )

    successful = [r for r in (r1, r2) if r is not None]
    assert len(successful) == 1
