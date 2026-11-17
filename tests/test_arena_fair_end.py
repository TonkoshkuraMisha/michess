# --- FILE: tests/test_arena_fair_end.py ---
"""Честный конец арены (таск 33.1): последний старт, итоги после последней партии, неявка, ранняя ничья, порядок."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.arena import Arena, ArenaGame
from src.models.game import Game, GameStatus
from src.services import arena
from src.services.game_state import state_manager

API = "/api/v1/arenas"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def blitz(now: datetime, *, started: timedelta, left: timedelta) -> Arena:
    return Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now - started, ends_at=now + left)


async def _game(db, item: Arena, white, black) -> int:
    game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.IN_PROGRESS)
    db.add(game)
    await db.flush()
    db.add(ArenaGame(arena_id=item.id, game_id=game.id, white_id=white.id, black_id=black.id))
    await db.flush()
    return game.id


def test_last_start_leaves_time_for_one_game():
    now = datetime(2026, 11, 17, 19, 0, tzinfo=UTC)
    item = Arena(base_time_ms=180_000, increment_ms=2_000, starts_at=now, ends_at=now + timedelta(minutes=60))
    # 3+2: 2 × (3 мин + 40 × 2 с) = 8 мин 40 с до конца.
    assert arena.last_start(item) == now + timedelta(minutes=60) - timedelta(minutes=8, seconds=40)
    assert arena.pairing_open(item, now + timedelta(minutes=51)) is True
    assert arena.pairing_open(item, now + timedelta(minutes=52)) is False
    assert arena.status(item, now + timedelta(minutes=52)) == "closing"
    assert arena.status(item, now + timedelta(minutes=61), open_games=1) == "closing"   # ждём последнюю партию
    assert arena.status(item, now + timedelta(minutes=61), open_games=0) == "finished"


async def test_no_pairs_after_last_start_but_open_games_still_count(client, db_session, test_user_1, test_user_2,
                                                                     token_user_1):
    now = datetime.now(UTC)
    item = blitz(now, started=timedelta(minutes=55), left=timedelta(minutes=5))      # последний старт уже прошёл
    db_session.add(item)
    await db_session.commit()
    for user in (test_user_1, test_user_2):
        await arena.join(db_session, item, user)
    closed = client.post(f"{API}/{item.id}/ready", headers=auth(token_user_1))
    assert closed.status_code == 409 and closed.json()["detail"]["code"] == "arena_pairing_closed"

    # Партия, начатая до последнего старта, идёт после конца арены — итоги ждут её и засчитывают.
    item.ends_at = now - timedelta(minutes=1)
    game_id = await _game(db_session, item, test_user_1, test_user_2)
    await db_session.commit()
    view = client.get(f"{API}/{item.id}").json()
    assert (view["status"], view["open_games"]) == ("closing", 1)
    await arena.on_game_finished(db_session, game_id, "1-0", termination="resignation", plies=60)
    await db_session.commit()
    final = client.get(f"{API}/{item.id}").json()
    assert final["status"] == "finished"
    assert [(s["username"], s["score"]) for s in final["standings"]] == [("player1", 2), ("player2", 0)]


async def test_early_agreed_draw_scores_nothing(db_session, test_user_1, test_user_2):
    now = datetime.now(UTC)
    item = blitz(now, started=timedelta(minutes=5), left=timedelta(minutes=50))
    db_session.add(item)
    await db_session.commit()
    for user in (test_user_1, test_user_2):
        await arena.join(db_session, item, user)
    quick = await _game(db_session, item, test_user_1, test_user_2)
    await arena.on_game_finished(db_session, quick, "1/2-1/2", termination="agreement", plies=6)
    played = await _game(db_session, item, test_user_2, test_user_1)
    await arena.on_game_finished(db_session, played, "1/2-1/2", termination="agreement", plies=60)
    by_rule = await _game(db_session, item, test_user_1, test_user_2)
    await arena.on_game_finished(db_session, by_rule, "1/2-1/2", termination="stalemate", plies=8)
    await db_session.commit()
    rows = {g.game_id: (g.white_points, g.black_points)
            for g in (await db_session.execute(select(ArenaGame))).scalars()}
    assert rows[quick] == (0, 0)            # договорная ничья до 10-го хода
    assert rows[played] == (1, 1)
    assert rows[by_rule] == (1, 1)          # ничья по правилам — как обычно


async def test_no_show_loses_and_unknown_abort_closes_without_points(client, db_session, test_user_1, test_user_2,
                                                                      token_user_1, token_user_2):
    now = datetime.now(UTC)
    item = blitz(now, started=timedelta(minutes=5), left=timedelta(minutes=50))
    db_session.add(item)
    await db_session.commit()
    for token in (token_user_1, token_user_2):
        client.post(f"{API}/{item.id}/join", headers=auth(token))
    client.post(f"{API}/{item.id}/ready", headers=auth(token_user_1))
    game_id = client.post(f"{API}/{item.id}/ready", headers=auth(token_user_2)).json()["game_id"]
    assert await arena.is_arena_game(db_session, game_id) is True

    # Белые не сделали первый ход — таймаут отменяет партию: в арене это поражение белых.
    aborted = await state_manager.abort_game(db_session, game_id)
    assert aborted["status"] == "aborted"
    record = (await db_session.execute(select(ArenaGame).where(ArenaGame.game_id == game_id))).scalar_one()
    await db_session.refresh(record)
    assert (record.result, record.white_points, record.black_points) == ("0-1", 0, 2)

    # Отмена при сверке после сбоя (сторона неизвестна) — партия закрыта без очков, итоги не зависают.
    other = await _game(db_session, item, test_user_1, test_user_2)
    assert await arena.on_game_aborted(db_session, other, None) is True
    await db_session.commit()
    assert await arena.open_games(db_session, item.id) == 0


@pytest.mark.parametrize("results, expected", [
    ([], None),
    ([(1500, 1.0), (1500, 0.0)], 1500),
    ([(1600, 1.0), (1400, 1.0)], 1900),
])
def test_performance(results, expected):
    assert arena.performance(results) == expected


async def test_equal_points_ranked_by_performance(db_session, test_user_1, test_user_2):
    from src.models.user import User

    now = datetime.now(UTC)
    item = blitz(now, started=timedelta(minutes=5), left=timedelta(minutes=50))
    strong = User(username="strong", hashed_password="x")
    weak = User(username="weak", hashed_password="x")
    db_session.add_all([item, strong, weak])
    await db_session.commit()
    for user, rating in ((test_user_1, 1500), (test_user_2, 1500), (strong, 2200), (weak, 900)):
        player = await arena.join(db_session, item, user)
        player.rating = rating
    await db_session.commit()
    # Оба набирают по 2 очка, но player1 — победой над сильным, player2 — над слабым.
    g1 = await _game(db_session, item, test_user_1, strong)
    await arena.on_game_finished(db_session, g1, "1-0", termination="resignation", plies=50)
    g2 = await _game(db_session, item, test_user_2, weak)
    await arena.on_game_finished(db_session, g2, "1-0", termination="resignation", plies=50)
    await db_session.commit()
    table = await arena.standings(db_session, item.id)
    assert [row["username"] for row in table[:2]] == ["player1", "player2"]
    assert table[0]["performance"] > table[1]["performance"]
