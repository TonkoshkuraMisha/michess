# --- FILE: tests/test_watch.py ---
"""«Просмотр» (таск 16.3): фильтры архива, «Партия дня», показатели и места «забавных подборок»."""

import chess
import pytest

from src.models.collection import CollectionEntry
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import collections

API = "/api/v1/watch"
ARCHIVE = "!historical_archive_no_login!"
FOOLS_MATE = '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n'


def _pgn(moves: str, result: str) -> str:
    return f'[Result "{result}"]\n\n{moves} {result}\n'


@pytest.fixture
async def archive(db_session, test_user_1, test_user_2):
    tal = User(username="Tal, Mikhail", hashed_password=ARCHIVE)
    botvinnik = User(username="Botvinnik, Mikhail", hashed_password=ARCHIVE)
    db_session.add_all([tal, botvinnik])
    await db_session.flush()
    games = []
    for white, black, date, eco, result in (
        (tal, botvinnik, "1960.03.15", "B12", "1-0"),
        (botvinnik, tal, "1961.04.01", "E20", "1-0"),
        (tal, botvinnik, "1961.04.20", "C60", "1/2-1/2"),
        (test_user_1, test_user_2, "1960.01.01", "B12", "1-0"),   # не архив
    ):
        game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED, result=result,
                    pgn=_pgn("1. e4 e5", result), pgn_date=date, eco=eco)
        db_session.add(game)
        games.append(game)
    await db_session.commit()
    return games


# --- показатели подборок -------------------------------------------------------------------------------

def test_metrics_of_a_short_mate():
    m = collections.game_metrics(FOOLS_MATE)
    assert m is not None and (m.plies, m.checkmate, m.checks, m.captures, m.decisive) == (4, True, 1, 0, True)


def test_stalemate_promotions_and_capture_streak():
    stalemate = collections.game_metrics('[Result "1/2-1/2"]\n[SetUp "0"]\n\n'
                                         '1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 '
                                         '7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6 10. Qe6 1/2-1/2\n')
    assert stalemate is not None and stalemate.stalemate and stalemate.capture_streak == 1
    promo = collections.game_metrics(_pgn("1. e4 f5 2. exf5 g6 3. fxg6 Nf6 4. gxh7 Ng8 5. hxg8=Q Rxg8", "1-0"))
    assert promo is not None and promo.promotions == 1 and promo.capture_streak == 2


def test_passed_pawns():
    board = chess.Board("4k3/8/8/3P4/8/8/p7/4K3 w - - 0 1")  # d5 у белых и a2 у чёрных — обе проходные
    assert collections.passed_pawns(board) == 2
    assert collections.passed_pawns(chess.Board()) == 0


def test_ranking_skips_duplicates_and_filters():
    mate = collections.game_metrics(FOOLS_MATE)
    long_draw = collections.Metrics(80, False, 0, 0, 0, 0, 0, False, False, 1)
    resign = collections.Metrics(2, True, 0, 0, 0, 0, 0, False, False, 2)
    ranked = collections.rank_collections({1: mate, 2: mate, 3: long_draw, 4: resign})
    assert ranked["shortest"] == [(1, 4)]                    # дубль и сдача без мата — не в подборке
    assert ranked["peaceful"][0] == (3, 0)
    assert ranked["stalemates"] == [] and ranked["promotions"] == []


# --- API --------------------------------------------------------------------------------------------------

async def test_archive_filters(client, archive):
    everything = client.get(f"{API}/archive").json()
    assert everything["total"] == 3                           # только архив
    assert [g["year"] for g in everything["items"]] == ["1961", "1961", "1960"]
    by_player = client.get(f"{API}/archive", params={"player": "TAL"}).json()
    assert by_player["total"] == 3
    filtered = client.get(f"{API}/archive", params={"year_from": 1961, "eco": "e2", "result": "1-0"}).json()
    assert [(g["white"], g["eco"]) for g in filtered["items"]] == [("Botvinnik, Mikhail", "E20")]
    assert client.get(f"{API}/archive", params={"year_to": 1960}).json()["total"] == 1
    assert client.get(f"{API}/archive", params={"eco": "Z1"}).status_code == 422


async def test_game_of_the_day_is_stable_and_decisive(client, archive):
    first = client.get(f"{API}/game-of-the-day").json()
    assert first == client.get(f"{API}/game-of-the-day").json()
    assert first["game"]["result"] in ("1-0", "0-1")


async def test_collections_endpoint(client, archive, db_session):
    db_session.add_all([CollectionEntry(collection="checks", rank=1, game_id=archive[1].id, value=12),
                        CollectionEntry(collection="checks", rank=2, game_id=archive[0].id, value=7)])
    await db_session.commit()
    body = client.get(f"{API}/collections").json()["collections"]
    assert set(body) == set(collections.COLLECTIONS)
    assert [(g["id"], g["value"]) for g in body["checks"]] == [(archive[1].id, 12), (archive[0].id, 7)]
    assert body["shortest"] == []
