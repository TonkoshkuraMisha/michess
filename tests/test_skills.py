"""Карта навыков (таск 22.1): разделы и слабые темы по попыткам задач, ошибки в партиях, тренажёры, дебюты, курсы."""

from datetime import UTC, datetime

import pytest

from src.models.game import Game, GameStatus
from src.models.lesson import LessonProgress
from src.models.puzzle import PersonalPuzzle, Puzzle, PuzzleAttempt, PuzzleTheme
from src.models.repertoire import Repertoire, RepertoireCard
from src.models.trainer import TrainerResult

API = "/api/v1/skills"
NOW = datetime(2026, 11, 16, tzinfo=UTC)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def history(db_session, test_user_1, test_user_2):
    uid = test_user_1.id
    puzzles = {}
    for index, theme in enumerate(("fork", "pin", "back_rank_mate")):
        puzzle = Puzzle(source="lichess", source_id=f"p{index}", fen="8/8/8/8/8/8/8/K6k w - - 0 1", moves="a1a2", rating=1500)
        db_session.add(puzzle)
        await db_session.flush()
        db_session.add(PuzzleTheme(puzzle_id=puzzle.id, theme=theme))
        puzzles[theme] = puzzle.id
    # fork: 6 из 6, pin: 1 из 5, мат по последней горизонтали: 2 попытки — мало данных.
    for theme, solved, failed in (("fork", 6, 0), ("pin", 1, 4), ("back_rank_mate", 1, 1)):
        for ok in [True] * solved + [False] * failed:
            db_session.add(PuzzleAttempt(user_id=uid, puzzle_id=puzzles[theme], solved=ok, rating_before=1500,
                                         rating_after=1500))
    db_session.add(PuzzleAttempt(user_id=test_user_2.id, puzzle_id=puzzles["pin"], solved=True, rating_before=1,
                                 rating_after=1))
    game = Game(white_player_id=uid, black_player_id=test_user_2.id, status=GameStatus.COMPLETED, result="0-1")
    db_session.add(game)
    await db_session.flush()
    # Темы личной задачи хранятся так, как их пишет personal_puzzles.extract_for_game: коды через запятую.
    for ply, (themes, done) in enumerate((("fork,pin", False), ("fork", True), ("unknown_theme", False)), start=10):
        db_session.add(PersonalPuzzle(user_id=uid, game_id=game.id, ply=ply, fen="x", solution="a1a2", played="a1b1",
                                      cp_loss=300, themes=themes, done=done))
    db_session.add_all([TrainerResult(user_id=uid, trainer="coord_find", level=1, score=s, time_ms=1000) for s in (5, 9)])
    rep = Repertoire(user_id=uid, name="", color="white")
    db_session.add(rep)
    await db_session.flush()
    db_session.add_all([
        RepertoireCard(repertoire_id=rep.id, position="a", ease=2.5, interval_days=0, repetitions=0, lapses=0),
        RepertoireCard(repertoire_id=rep.id, position="b", ease=2.5, interval_days=1, repetitions=1, lapses=0,
                       first_reviewed_at=NOW),
        RepertoireCard(repertoire_id=rep.id, position="c", ease=2.5, interval_days=6, repetitions=2, lapses=0,
                       first_reviewed_at=NOW),
    ])
    db_session.add_all([
        LessonProgress(user_id=uid, lesson_id="endgame-kq", step=1, steps_total=1, completed_at=NOW),
        LessonProgress(user_id=uid, lesson_id="endgame-kr", step=0, steps_total=1),
        LessonProgress(user_id=uid, lesson_id="mates-back_rank_mate", step=1, steps_total=1, completed_at=NOW),
        LessonProgress(user_id=uid, lesson_id="mates-exam", step=1, steps_total=1, completed_at=NOW),
    ])
    await db_session.commit()


async def test_skill_map(client, history, token_user_1):
    body = client.get(API, headers=auth(token_user_1)).json()
    assert body["username"] == "player1"
    sections = {s["section"]: s for s in body["sections"]}
    assert (sections["A"]["attempts"], sections["A"]["score"]) == (6, 100)
    assert (sections["B"]["attempts"], sections["B"]["score"]) == (5, 20)
    assert (sections["F"]["attempts"], sections["F"]["score"]) == (2, None)  # мало данных
    assert [t["theme"] for t in body["weakest_themes"]] == ["pin", "fork"]
    assert body["mistakes"] == {"total": 3, "fixed": 1,
                                "themes": [{"theme": "fork", "count": 2}, {"theme": "pin", "count": 1}]}
    assert body["trainers"] == [{"trainer": "coord_find", "attempts": 2, "best": 9, "max_level": 1}]
    assert body["openings"] == {"repertoires": 1, "new": 1, "learning": 1, "learned": 1}
    assert body["endgames"] == {"done": 1, "total": 25} and body["mates"] == {"done": 1, "total": 20}


async def test_skill_map_is_private_and_empty_for_newcomers(client, token_user_2):
    assert client.get(API).status_code == 401
    body = client.get(API, headers=auth(token_user_2)).json()
    assert body["weakest_themes"] == [] and body["mistakes"]["total"] == 0 and body["openings"]["repertoires"] == 0
