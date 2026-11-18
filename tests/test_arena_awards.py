# --- FILE: tests/test_arena_awards.py ---
"""
Награды арен (таск 33.5, src/services/arena_awards.py): тройка таблицы итогов законченной арены получает места,
уведомление и достижения; без партий места нет; незаконченная арена и швейцарка до последнего тура не награждаются;
повторный запуск ничего не добавляет; кубки видны в профиле через настоящий запрос. Время зафиксировано.
"""

import itertools
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from src.models.arena import Arena, ArenaAward, ArenaGame, ArenaPlayer
from src.models.game import Game, GameStatus
from src.models.social import Notification
from src.models.user import User
from src.services import achievements, arena_awards
from src.worker.celery_app import celery_app

NOW = datetime(2026, 11, 18, 18, 0, tzinfo=UTC)
_NAMES = itertools.count()  # имена игроков без повторов во всех аренах теста


async def _arena(db, scores: list[tuple[int, int]], *, ends_ago: timedelta = timedelta(minutes=10),
                 open_game: bool = False, fmt: str = "arena") -> tuple[Arena, list[User]]:
    """Арена блица с участниками (очки, партии); open_game — одна партия ещё идёт."""
    users = [User(username=f"aw{next(_NAMES)}", hashed_password="pw") for _ in scores]
    arena = Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=NOW - timedelta(hours=1) - ends_ago,
                  ends_at=NOW - ends_ago, format=fmt, rounds=3 if fmt == "swiss" else 0)
    db.add_all([*users, arena])
    await db.flush()
    for i, (user, (score, games)) in enumerate(zip(users, scores, strict=True)):
        db.add(ArenaPlayer(arena_id=arena.id, user_id=user.id, score=score, games=games, wins=score // 2,
                           rating=1500 + i))
    if open_game:
        game = Game(white_player_id=users[0].id, black_player_id=users[1].id, status=GameStatus.IN_PROGRESS)
        db.add(game)
        await db.flush()
        db.add(ArenaGame(arena_id=arena.id, game_id=game.id, white_id=users[0].id, black_id=users[1].id))
    await db.commit()
    return arena, users


async def test_podium_of_a_finished_arena(client, db_session):
    arena, users = await _arena(db_session, [(4, 3), (9, 5), (0, 0), (6, 4), (1, 2)])

    assert await arena_awards.award_finished(db_session, NOW) == 3
    awards = (await db_session.execute(select(ArenaAward).order_by(ArenaAward.place))).scalars().all()
    assert [(a.place, a.user_id, a.category) for a in awards] == [
        ("1", users[1].id, "blitz"), ("2", users[3].id, "blitz"), ("3", users[0].id, "blitz")]
    notes = (await db_session.execute(select(Notification).where(Notification.kind == "arena_podium"))).scalars().all()
    assert sorted(n.payload["place"] for n in notes) == [1, 2, 3]
    assert await arena_awards.award_finished(db_session, NOW) == 0  # награждают один раз

    profile = client.get(f"/api/v1/profile/{users[1].username}").json()
    assert profile["arena_trophies"] == {"gold": 1, "silver": 0, "bronze": 0}
    unlocked = {a["code"] for a in (await achievements.evaluate(db_session, users[1]))["achievements"] if a["earned_at"]}
    assert {"arena_podium", "arena_win"} <= unlocked


async def test_no_place_without_games_and_no_awards_before_the_end(db_session):
    _, users = await _arena(db_session, [(3, 2), (0, 0)])
    await _arena(db_session, [(5, 3), (2, 2)], open_game=True)  # партия ещё идёт — итоги не окончательные
    await _arena(db_session, [(5, 3), (2, 2)], ends_ago=-timedelta(minutes=30))  # ещё не кончилась
    await _arena(db_session, [(5, 3), (2, 2)], fmt="swiss")  # швейцарка без записанного конца турнира
    await _arena(db_session, [(5, 3), (2, 2)], ends_ago=arena_awards.LOOKBACK + timedelta(hours=1))  # давняя

    assert await arena_awards.award_finished(db_session, NOW) == 1
    only = (await db_session.execute(select(ArenaAward))).scalar_one()
    assert (only.place, only.user_id) == ("1", users[0].id)


def test_awards_task_is_scheduled():
    assert "arena_awards" in {entry["task"] for entry in celery_app.conf.beat_schedule.values()}
