# --- FILE: tests/test_arena_league.py ---
"""Месячная лига арен (таск 33.5): правила порядка и настоящий путь клиента GET /api/v1/arenas/league."""

from datetime import UTC, datetime, timedelta

from src.models.arena import Arena, ArenaPlayer
from src.models.user import User
from src.services import arena_league
from src.services.arena_league import Entry

NOVEMBER = datetime(2026, 11, 5, 18, 0, tzinfo=UTC)
BLITZ = (180_000, 2_000)
BULLET = (120_000, 1_000)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_rank_orders_by_score_then_best_arena_then_fewer_arenas():
    table = arena_league.rank([
        Entry(1, "many", 10, 4, 3),
        Entry(2, "peak", 10, 6, 3),
        Entry(3, "quick", 10, 4, 2),
        Entry(4, "top", 12, 3, 5),
    ])
    assert [(row["place"], row["username"]) for row in table] == [(1, "top"), (2, "peak"), (3, "quick"), (4, "many")]


def test_league_categories_come_from_the_arena_schedule():
    # Швейцарки (10+5, 15+10 — рапид) в лигу не идут, арены расписания — пуля и блиц.
    assert arena_league.LEAGUE_CATEGORIES == ("bullet", "blitz")


async def test_league_through_the_real_client_path(client, db_session, test_user_1, token_user_1):
    others = [User(username=f"league{i}", hashed_password="x") for i in range(2)]
    db_session.add_all(others)
    await db_session.commit()

    def arena(control: tuple[int, int], moment: datetime, fmt: str = "arena") -> Arena:
        return Arena(base_time_ms=control[0], increment_ms=control[1], starts_at=moment,
                     ends_at=moment + timedelta(hours=1), format=fmt)

    blitz_a, blitz_b = arena(BLITZ, NOVEMBER), arena(BLITZ, NOVEMBER + timedelta(days=2))
    bullet = arena(BULLET, NOVEMBER)
    october = arena(BLITZ, datetime(2026, 10, 30, tzinfo=UTC))
    swiss = arena(BLITZ, NOVEMBER, "swiss")
    db_session.add_all([blitz_a, blitz_b, bullet, october, swiss])
    await db_session.commit()

    def player(item: Arena, user: User, score: int, games: int = 3) -> ArenaPlayer:
        return ArenaPlayer(arena_id=item.id, user_id=user.id, score=score, games=games, rating=1500)

    db_session.add_all([
        player(blitz_a, test_user_1, 6), player(blitz_b, test_user_1, 5),          # 11 за две арены
        player(blitz_a, others[0], 8),                                              # 8 за одну
        player(blitz_b, others[1], 0, games=0),                                     # вошёл, но не играл — не в лиге
        player(bullet, others[1], 20),                                              # другая категория
        player(october, others[0], 30),                                             # другой сезон
        player(swiss, others[0], 30),                                               # швейцарка
    ])
    await db_session.commit()

    response = client.get("/api/v1/arenas/league", params={"category": "blitz", "season": "2026-11"},
                          headers=auth(token_user_1))
    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["season"], data["category"], data["categories"], data["players"]) == (
        "2026-11", "blitz", ["bullet", "blitz"], 2)
    assert [(row["username"], row["score"], row["best"], row["arenas"]) for row in data["table"]] == [
        (test_user_1.username, 11, 6, 2), ("league0", 8, 8, 1)]
    assert data["me"]["place"] == 1

    bullet_table = client.get("/api/v1/arenas/league", params={"category": "bullet", "season": "2026-11"}).json()
    assert [row["username"] for row in bullet_table["table"]] == ["league1"] and bullet_table["me"] is None
    assert client.get("/api/v1/arenas/league", params={"season": "2026-13"}).status_code == 422
    assert client.get("/api/v1/arenas/league", params={"category": "daily"}).status_code == 422
