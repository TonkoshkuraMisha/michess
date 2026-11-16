# --- FILE: tests/test_public_api.py ---
"""
Прозрачность и открытые данные (таск 24.3): открытое API только для чтения, журналы калибровки ботов, выгрузка
своих партий в PGN, партии с других сайтов в выгрузке и при удалении аккаунта.
"""

import datetime as dt

import pytest
from sqlalchemy import func, select

from src.core.config import settings
from src.core.security import get_password_hash
from src.models.game import Game, GameStatus
from src.models.imported_game import ImportedGame
from src.models.puzzle import PersonalPuzzle
from src.services.bots import calibration

PUBLIC = "/api/v1/public"
PGN = '[Event "t"]\n[White "player1"]\n[Black "player2"]\n[Result "{result}"]\n\n1. e4 e5 {result}'


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def games(db_session, test_user_1, test_user_2):
    """Три партии player1: рейтинговая и товарищеская завершённые и одна идущая."""
    now = dt.datetime(2026, 11, 1, 12, tzinfo=dt.UTC)
    rows = [
        Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED, result="1-0",
             termination="checkmate", is_rated=True, base_time_ms=180000, increment_ms=2000, eco="C20",
             pgn=PGN.format(result="1-0"), finished_at=now),
        Game(white_player_id=test_user_2.id, black_player_id=test_user_1.id, status=GameStatus.COMPLETED, result="0-1",
             termination="resignation", is_rated=False, base_time_ms=600000, increment_ms=0,
             pgn=PGN.format(result="0-1"), finished_at=now + dt.timedelta(hours=1)),
        Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.IN_PROGRESS,
             pgn=PGN.format(result="*")),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    return rows


def test_index_lists_endpoints_and_the_limit(client):
    body = client.get(PUBLIC).json()
    assert body["version"] == 1 and body["read_only"] is True
    assert body["rate_limit"]["requests"] == settings.RATE_LIMIT_PUBLIC_API
    assert f"{PUBLIC}/players/{{username}}/games.pgn" in body["endpoints"]


async def test_player_profile_has_ratings_and_nothing_private(client, games, db_session, test_user_1):
    test_user_1.email = "secret@example.org"
    await db_session.commit()
    body = client.get(f"{PUBLIC}/players/player1").json()
    assert body["username"] == "player1" and body["bot"] is False and body["games"] == 2
    assert set(body["ratings"]) == {"bullet", "blitz", "rapid", "classical"} and body["ratings"]["blitz"] == 1200
    assert "email" not in body and "secret@example.org" not in str(body)
    missing = client.get(f"{PUBLIC}/players/nobody")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "user_not_found"


async def test_games_are_finished_only_newest_first_and_filterable(client, games):
    body = client.get(f"{PUBLIC}/players/player1/games").json()
    assert body["total"] == 2 and [g["id"] for g in body["games"]] == [games[1].id, games[0].id]
    first = body["games"][1]
    assert (first["white"], first["black"], first["result"], first["rated"]) == ("player1", "player2", "1-0", True)
    assert (first["speed"], first["base_time_s"], first["increment_s"], first["eco"]) == ("blitz", 180, 2, "C20")
    assert first["pgn"] == f"{PUBLIC}/games/{games[0].id}.pgn"
    rated = client.get(f"{PUBLIC}/players/player1/games", params={"rated": "true"}).json()
    assert [g["id"] for g in rated["games"]] == [games[0].id]
    page = client.get(f"{PUBLIC}/players/player1/games", params={"limit": 1, "offset": 1}).json()
    assert [g["id"] for g in page["games"]] == [games[0].id] and page["total"] == 2
    assert client.get(f"{PUBLIC}/players/player1/games", params={"limit": 1000}).status_code == 422


async def test_pgn_downloads(client, games):
    many = client.get(f"{PUBLIC}/players/player1/games.pgn")
    assert many.status_code == 200 and many.headers["x-total-count"] == "2"
    assert many.headers["content-type"].startswith("application/x-chess-pgn")
    assert many.text.count('[Event "t"]') == 2 and "*" not in many.text
    one = client.get(f"{PUBLIC}/games/{games[0].id}.pgn")
    assert one.status_code == 200 and "1. e4 e5 1-0" in one.text
    meta = client.get(f"{PUBLIC}/games/{games[0].id}").json()
    assert meta["white"] == "player1" and meta["termination"] == "checkmate"
    # Идущая партия наружу не отдаётся — ни записью, ни сведениями.
    assert client.get(f"{PUBLIC}/games/{games[2].id}.pgn").status_code == 404
    assert client.get(f"{PUBLIC}/games/{games[2].id}").json()["detail"]["code"] == "game_not_found"


async def test_leaderboard_rating_history_and_bots(client, games):
    board = client.get(f"{PUBLIC}/leaderboard", params={"category": "rapid", "limit": 5}).json()
    assert board["category"] == "rapid" and {p["username"] for p in board["players"]} == {"player1", "player2"}
    assert set(board["players"][0]) == {"rank", "username", "rating"}
    assert client.get(f"{PUBLIC}/players/player1/rating-history").status_code == 200
    bots = client.get(f"{PUBLIC}/bots").json()
    kinds = {bot["kind"] for bot in bots["bots"]}
    assert kinds == {"historical", "archetype"}
    assert all({"id", "declared_rating", "rating", "measured", "games", "ci95"} <= set(bot) for bot in bots["bots"])
    assert any(bot["measured"] and bot["ci95"] for bot in bots["bots"])
    assert bots["calibration"]["games"] > 0 and bots["runs"]


async def test_public_api_is_rate_limited(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_API", 2)
    assert client.get(PUBLIC).status_code == 200
    assert client.get(f"{PUBLIC}/leaderboard").status_code == 200
    limited = client.get(PUBLIC)
    assert limited.status_code == 429 and limited.json()["detail"]["code"] == "public_api_rate_limited"
    assert limited.headers["Retry-After"]


def test_calibration_runs_are_listed_and_readable(client):
    body = client.get("/api/v1/bots/calibration/runs").json()
    runs = body["runs"]
    assert runs and body["calibration"]["date"]
    assert runs == sorted(runs, key=lambda r: (r["date"], r["name"]), reverse=True)
    assert {r["kind"] for r in runs} <= {"log", "pgn"} and all(r["size"] > 0 for r in runs)
    log = next(r for r in runs if r["kind"] == "log")
    text = client.get(f"/api/v1/bots/calibration/runs/{log['name']}")
    assert text.status_code == 200 and text.headers["content-type"].startswith("text/plain") and len(text.text) > 100


@pytest.mark.parametrize("name", ["nope.log", "2026-11-14_x.txt", "..%2Fcalibrate_bots.py", "2026-11-14_weak curve.log"])
def test_unknown_or_unsafe_run_names_are_404(client, name):
    response = client.get(f"/api/v1/bots/calibration/runs/{name}")
    assert response.status_code == 404


def test_run_names_cannot_leave_the_folder():
    assert calibration.read_run("../calibrate_bots.py") is None
    assert calibration.read_run("..\\\\calibrate_bots.py") is None
    assert calibration.read_run("2026-11-14_../../x.log") is None


# --- свои партии и данные -----------------------------------------------------------------------------------------


async def test_own_games_pgn_has_every_finished_game_in_order(client, games, token_user_1, token_user_2):
    assert client.get("/api/v1/account/games.pgn").status_code == 401
    response = client.get("/api/v1/account/games.pgn", headers=_auth(token_user_1))
    assert response.status_code == 200 and response.headers["x-total-count"] == "2"
    assert "attachment" in response.headers["content-disposition"] and ".pgn" in response.headers["content-disposition"]
    # От старых к новым; идущая партия не входит.
    assert response.text.index("1. e4 e5 1-0") < response.text.index("1. e4 e5 0-1") and "e5 *" not in response.text
    assert client.get("/api/v1/account/games.pgn", headers=_auth(token_user_1), params={"offset": 2}).text == ""


async def _imported(db_session, user_id: int) -> ImportedGame:
    record = ImportedGame(user_id=user_id, source="lichess", external_id="abcd1234", color="white",
                          white_name="my_lichess_nick", black_name="rival", result="1-0", pgn=PGN.format(result="1-0"))
    db_session.add(record)
    await db_session.flush()
    db_session.add(PersonalPuzzle(user_id=user_id, imported_game_id=record.id, ply=3, fen="8/8/8/8/8/8/8/K6k w - - 0 1",
                                  solution="a1a2", played="a1b1", cp_loss=300))
    await db_session.commit()
    return record


async def test_export_includes_imported_games(client, db_session, test_user_1, token_user_1):
    await _imported(db_session, test_user_1.id)
    data = client.get("/api/v1/account/export", headers=_auth(token_user_1)).json()
    assert [(g["source"], g["white"], g["color"]) for g in data["imported_games"]] == [("lichess", "my_lichess_nick", "white")]
    assert "1. e4 e5" in data["imported_games"][0]["pgn"]
    assert data["personal_puzzles"][0]["imported_game_id"] == data["imported_games"][0]["id"]


async def test_deleting_the_account_removes_imported_games(client, db_session, test_user_1, token_user_1):
    """Аккаунт обезличивается, а не удаляется из базы — каскад не сработает; ник с другого сайта остаться не должен."""
    await _imported(db_session, test_user_1.id)
    test_user_1.hashed_password = get_password_hash("secret-pass-1")
    await db_session.commit()
    response = client.post("/api/v1/account/delete", headers=_auth(token_user_1), json={"password": "secret-pass-1"})
    assert response.status_code == 204
    db_session.expire_all()
    assert await db_session.scalar(select(func.count()).select_from(ImportedGame)) == 0
    assert await db_session.scalar(select(func.count()).select_from(PersonalPuzzle)) == 0
