# --- FILE: tests/test_rating_categories.py ---
"""
Рейтинг разделён по категориям контроля времени (пуля/блиц/рапид/классика) — одна партия
меняет только свою категорию, а счётчик сыгранных партий для K-фактора ELO хранится на
пользователе, а не считается запросом COUNT(*) при каждом завершении.
"""

import pytest

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.game_state import state_manager
from src.services.rating import classify_time_control


@pytest.mark.parametrize(("base_time_ms", "increment_ms", "expected"), [
    (60_000, 0, "bullet"),          # 1 мин
    (120_000, 1_000, "bullet"),     # 2+1
    (180_000, 0, "blitz"),          # 3 мин — ровно на границе пули/блица
    (300_000, 3_000, "blitz"),      # 5+3
    (600_000, 0, "rapid"),          # 10 мин
    (900_000, 10_000, "rapid"),     # 15+10
    (1_800_000, 0, "classical"),    # 30 мин без добавления — за порогом рапида
    (1_800_000, 20_000, "classical"),  # 30+20
])
def test_classify_time_control_matches_lichess_thresholds(base_time_ms, increment_ms, expected):
    assert classify_time_control(base_time_ms, increment_ms) == expected


async def _rated_game(db_session, white: User, black: User, base_time_ms: int, increment_ms: int) -> Game:
    game = Game(
        white_player_id=white.id,
        black_player_id=black.id,
        status=GameStatus.IN_PROGRESS,
        base_time_ms=base_time_ms,
        increment_ms=increment_ms,
        is_rated=True,
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)
    await state_manager.initialize_game(game.id, white.id, black.id, base_time_ms, increment_ms)
    return game


async def test_finish_game_only_moves_the_rating_of_its_own_category(db_session):
    """Блиц-партия не трогает пулю/рапид/классику того же игрока."""
    white = User(
        username="cat_white", hashed_password="pw", bullet_rating=1300,
        blitz_rating=1500, rapid_rating=1700, classical_rating=1900,
    )
    black = User(
        username="cat_black", hashed_password="pw", bullet_rating=1300,
        blitz_rating=1500, rapid_rating=1700, classical_rating=1900,
    )
    db_session.add_all([white, black])
    await db_session.commit()
    await db_session.refresh(white)
    await db_session.refresh(black)

    game = await _rated_game(db_session, white, black, base_time_ms=180_000, increment_ms=0)  # блиц
    await state_manager.finish_game(db_session, game.id, "1-0", termination="checkmate")

    await db_session.refresh(white)
    await db_session.refresh(black)

    assert white.blitz_rating != 1500  # своя категория изменилась
    assert black.blitz_rating != 1500
    assert (white.bullet_rating, white.rapid_rating, white.classical_rating) == (1300, 1700, 1900)
    assert (black.bullet_rating, black.rapid_rating, black.classical_rating) == (1300, 1700, 1900)


async def test_games_played_counter_increments_per_category(db_session):
    """Счётчик сыгранных партий растёт по категории — без запроса COUNT(*) при завершении."""
    white = User(username="count_white", hashed_password="pw")
    black = User(username="count_black", hashed_password="pw")
    db_session.add_all([white, black])
    await db_session.commit()
    await db_session.refresh(white)
    await db_session.refresh(black)

    assert white.blitz_games_played == 0

    for _ in range(3):
        game = await _rated_game(db_session, white, black, base_time_ms=180_000, increment_ms=0)
        await state_manager.finish_game(db_session, game.id, "1/2-1/2", termination="agreement")

    await db_session.refresh(white)
    await db_session.refresh(black)

    assert white.blitz_games_played == 3
    assert black.blitz_games_played == 3
    # Другая категория для тех же игроков не затронута.
    assert white.bullet_games_played == 0


async def test_finish_game_ignores_unrated_games_played(db_session):
    """Неформальная (is_rated=False) партия не двигает рейтинг и не увеличивает счётчик."""
    white = User(username="casual_white", hashed_password="pw")
    black = User(username="casual_black", hashed_password="pw")
    db_session.add_all([white, black])
    await db_session.commit()
    await db_session.refresh(white)
    await db_session.refresh(black)

    game = Game(
        white_player_id=white.id, black_player_id=black.id, status=GameStatus.IN_PROGRESS,
        base_time_ms=180_000, increment_ms=0, is_rated=False,
    )
    db_session.add(game)
    await db_session.commit()
    await db_session.refresh(game)
    await state_manager.initialize_game(game.id, white.id, black.id, 180_000, 0)

    await state_manager.finish_game(db_session, game.id, "1-0", termination="checkmate")

    await db_session.refresh(white)
    assert white.blitz_rating == 1200
    assert white.blitz_games_played == 0


async def test_leaderboard_ranks_by_requested_category(client, db_session):
    strong_bullet = User(
        username="bullet_star", hashed_password="pw", bullet_rating=2200,
        blitz_rating=1000, rapid_rating=1000, classical_rating=1000,
    )
    strong_rapid = User(
        username="rapid_star", hashed_password="pw", bullet_rating=1000,
        blitz_rating=1000, rapid_rating=2200, classical_rating=1000,
    )
    db_session.add_all([strong_bullet, strong_rapid])
    await db_session.commit()

    bullet_top = client.get("/api/v1/profile/leaderboard?category=bullet").json()
    assert bullet_top[0]["username"] == "bullet_star"
    assert bullet_top[0]["rating"] == 2200

    rapid_top = client.get("/api/v1/profile/leaderboard?category=rapid").json()
    assert rapid_top[0]["username"] == "rapid_star"
    assert rapid_top[0]["rating"] == 2200

    # Без параметра category — то же, что явный блиц (значение по умолчанию).
    default_top = client.get("/api/v1/profile/leaderboard").json()
    blitz_top = client.get("/api/v1/profile/leaderboard?category=blitz").json()
    assert default_top == blitz_top
