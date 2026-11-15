# --- FILE: tests/test_league.py ---
"""Команды и сезонная лига (таск 17.2): очки с учётом рейтингов, сезон, команды, таблица."""

from datetime import UTC, datetime

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import league

API = "/api/v1/teams"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_points_rules():
    assert league.win_points(1500, 1500) == 2
    assert league.win_points(1500, 1900) == 4          # победа над сильным — больше, не выше 4
    assert league.win_points(1900, 1500) == 1          # над слабым — не меньше 1
    assert (league.draw_points(1500, 1700), league.draw_points(1700, 1500)) == (2, 1)


def test_season_bounds():
    key, start, end = league.season_bounds(now=datetime(2026, 12, 15, tzinfo=UTC))
    assert key == "2026-12" and start == datetime(2026, 12, 1, tzinfo=UTC) and end == datetime(2027, 1, 1, tzinfo=UTC)
    assert league.season_bounds("2026-02")[0] == "2026-02"


async def test_teams_and_league_table(client, db_session, token_user_1, token_user_2, test_user_1, test_user_2):
    created = client.post(API, json={"name": "  Kings   of  Rook "}, headers=auth(token_user_1))
    assert created.status_code == 201 and created.json()["name"] == "Kings of Rook"
    again = client.post(API, json={"name": "kings of rook"}, headers=auth(token_user_2))
    assert again.json()["detail"]["code"] == "team_name_taken"
    assert client.post(API, json={"name": "ab"}, headers=auth(token_user_2)).json()["detail"]["code"] == "team_name_invalid"
    other = client.post(API, json={"name": "Pawn Storm"}, headers=auth(token_user_2)).json()
    joined = client.post(f"{API}/{other['id']}/join", headers=auth(token_user_1)).json()
    assert joined["detail"]["code"] == "team_already_member"

    # Две рейтинговые партии этого сезона между командами и одна — с игроком без команды (не в счёт).
    third = User(username="lonely", hashed_password="x")
    db_session.add(third)
    await db_session.flush()
    now = datetime.now(UTC)
    for white, black, result, wr, br in ((test_user_1, test_user_2, "1-0", 1500, 1900),
                                         (test_user_2, test_user_1, "1/2-1/2", 1900, 1500),
                                         (test_user_1, third, "1-0", 1500, 1500)):
        db_session.add(Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED, is_rated=True,
                            result=result, white_initial_rating=wr, black_initial_rating=br, finished_at=now))
    await db_session.commit()

    table = client.get(f"{API}/league").json()
    rows = [(t["name"], t["points"], t["place"]) for t in table["teams"]]
    assert rows == [("Kings of Rook", 4 + 2, 1), ("Pawn Storm", 1, 2)]
    mine = client.get(f"{API}/mine", headers=auth(token_user_1)).json()["team"]
    assert mine["members"] == [{"username": "player1", "points": 6, "owner": True}]


async def test_join_leave_and_ownership(client, token_user_1, token_user_2):
    team = client.post(API, json={"name": "Endgame Club"}, headers=auth(token_user_1)).json()
    joined = client.post(f"{API}/{team['id']}/join", headers=auth(token_user_2)).json()
    assert {m["username"] for m in joined["members"]} == {"player1", "player2"}
    assert client.post(f"{API}/leave", headers=auth(token_user_1)).json() == {"team": None}
    after = client.get(f"{API}/{team['id']}").json()
    assert after["members"] == [{"username": "player2", "points": 0, "owner": True}]   # владение перешло
    client.post(f"{API}/leave", headers=auth(token_user_2))
    assert client.get(f"{API}/{team['id']}").status_code == 404                    # последний вышел — команды нет
    assert client.post(f"{API}/leave", headers=auth(token_user_2)).json()["detail"]["code"] == "team_not_member"
