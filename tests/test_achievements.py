# --- FILE: tests/test_achievements.py ---
"""Достижения и звания клуба (таск 17.6): только за реальные результаты, открытое не теряется."""

from datetime import UTC, datetime

from sqlalchemy import select

from src.models.achievement import UserAchievement
from src.models.game import Game, GameStatus
from src.models.lesson import LessonProgress
from src.models.user import User
from src.services import achievements


def by_code(result: dict) -> dict:
    return {a["code"]: a for a in result["achievements"]}


async def test_nothing_for_a_new_player(db_session, test_user_1):
    result = await achievements.evaluate(db_session, test_user_1)
    assert result["title"] == "newcomer"
    assert all(a["earned_at"] is None and a["progress"] == 0 for a in result["achievements"]
               if a["code"] not in ("puzzle_rating_1800", "rating_1500", "rating_1800", "rating_2000"))
    assert (await db_session.execute(select(UserAchievement))).scalars().all() == []


async def test_games_wins_and_lessons(client, db_session, test_user_1, test_user_2):
    bot = User(username="bot_x", hashed_password="x", is_bot=True)
    db_session.add(bot)
    await db_session.commit()
    now = datetime.now(UTC)
    db_session.add_all([
        Game(white_player_id=test_user_1.id, black_player_id=bot.id, status=GameStatus.COMPLETED, winner_id=test_user_1.id),
        Game(white_player_id=test_user_2.id, black_player_id=test_user_1.id, status=GameStatus.COMPLETED,
             winner_id=test_user_1.id),
        # Симуляция и незаконченная партия не считаются.
        Game(white_player_id=test_user_1.id, black_player_id=bot.id, status=GameStatus.COMPLETED, winner_id=test_user_1.id,
             is_simulation=True),
        Game(white_player_id=test_user_1.id, black_player_id=bot.id, status=GameStatus.IN_PROGRESS),
        *[LessonProgress(user_id=test_user_1.id, lesson_id=f"lesson-{i}", completed_at=now) for i in range(10)],
        LessonProgress(user_id=test_user_1.id, lesson_id="basics-pawn", completed_at=now),
        LessonProgress(user_id=test_user_1.id, lesson_id="endgame-kq-k", completed_at=now),
        LessonProgress(user_id=test_user_1.id, lesson_id="lesson-unfinished"),
    ])
    await db_session.commit()

    response = client.get("/api/v1/profile/player1/achievements")
    assert response.status_code == 200
    items = by_code(response.json())
    assert items["first_game"]["earned_at"] and items["first_game"]["new"] is True
    assert items["human_win"]["earned_at"]
    assert items["wins_10"]["progress"] == 2 and items["wins_10"]["earned_at"] is None
    assert items["lessons_10"]["progress"] == 10 and items["lessons_10"]["earned_at"]
    assert items["basics_done"]["progress"] == 1 and items["endgames_10"]["progress"] == 1

    # Повторный запрос: открытое уже записано, «новым» больше не считается.
    again = by_code(client.get("/api/v1/profile/player1/achievements").json())
    assert again["first_game"]["new"] is False and again["first_game"]["earned_at"] == items["first_game"]["earned_at"]
    assert client.get("/api/v1/profile/nobody/achievements").status_code == 404


def test_club_title():
    user = User(username="x", hashed_password="x", bullet_rating=1200, blitz_rating=1750, rapid_rating=1200,
                classical_rating=1200, bullet_games_played=0, blitz_games_played=3, rapid_games_played=0,
                classical_games_played=0)
    assert achievements.title(user) == "newcomer"
    user.blitz_games_played = 10
    assert achievements.title(user) == "candidate"
    user.blitz_rating = 900
    assert achievements.title(user) == "amateur"   # лучший рейтинг теперь 1200 (в других категориях)
    user.bullet_rating = user.rapid_rating = user.classical_rating = 800
    assert achievements.title(user) == "beginner"


async def test_closed_knight_tour(db_session, test_user_1):
    """Таск 19.4: замкнутый обход конём 8×8 — тренажёр пишет больше 100 очков; открытый и малые доски не считаются."""
    from src.models.trainer import TrainerResult

    db_session.add_all([
        TrainerResult(user_id=test_user_1.id, trainer="knight_tour", level=3, score=100, time_ms=1, mistakes=0),
        TrainerResult(user_id=test_user_1.id, trainer="knight_tour", level=1, score=200, time_ms=1, mistakes=0),
    ])
    await db_session.commit()
    assert by_code(await achievements.evaluate(db_session, test_user_1))["knight_tour_closed"]["earned_at"] is None
    db_session.add(TrainerResult(user_id=test_user_1.id, trainer="knight_tour", level=3, score=180, time_ms=1, mistakes=0))
    await db_session.commit()
    assert by_code(await achievements.evaluate(db_session, test_user_1))["knight_tour_closed"]["earned_at"]
