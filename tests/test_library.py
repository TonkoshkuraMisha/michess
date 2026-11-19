"""Библиотека партий (таски 27.1–27.2): разбор PGN, слияние одинаковых партий, коллекции, видимость, поиск, PGN."""

import pytest

from src.services import library

API = "/api/v1/library"

PGN = """[Event "Hastings"]
[Site "Hastings (England)"]
[Date "1934.??.??"]
[White "Botvinnik"]
[Black "Euwe"]
[Result "0-1"]
[ECO "D42"]

1. c4 {comment} c6 (1... e5 2. Nc3) 2. e4 d5 $1 3. exd5 cxd5 0-1

[White "Anon"]
[Black "Anon2"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[White "Broken"]
[Black "Game"]
[Result "*"]

1. e4 e5 2. Ke3 Nf6 *
"""


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_parse_strips_comments_and_variations():
    games = [library.parse_game(g) for g in library.read_text(PGN)]
    first = games[0]
    assert first.moves == ["c2c4", "c7c6", "e2e4", "d7d5", "e4d5", "c6d5"]
    assert (first.year, first.eco, first.result, first.date) == (1934, "D42", "0-1", "1934.??.??")
    assert games[1].eco == "C20" and games[1].opening  # кода в файле нет — определяется по таблице дебютов
    assert games[2].moves == ["e2e4", "e7e5"]  # нелегальный ход обрывает партию, а не импорт
    assert games[0].moves_hash != games[1].moves_hash


def test_open_pgn_reads_cp1251(tmp_path):
    path = tmp_path / "ru.pgn"
    path.write_bytes('[White "Ботвинник"]\n[Black "Эйве"]\n\n1. e4 e5 *\n'.encode("cp1251"))
    with library.open_pgn(str(path)) as handle:
        parsed = library.parse_game(next(library.read_games(handle)))
    assert parsed.white == "Ботвинник"


@pytest.fixture
async def seeded(db_session, test_user_1, test_user_2):
    public = await library.ensure_collection(db_session, "Партии/Классика")
    stats = await library.import_games(db_session, public, library.read_text(PGN))
    again = await library.import_games(db_session, public, library.read_text(PGN))
    private = await library.ensure_collection(db_session, "Личные", visibility="owner", owner_id=test_user_1.id)
    await library.import_games(db_session, private, library.read_text(PGN.split("\n\n[White \"Anon\"]")[0]))
    staff = await library.ensure_collection(db_session, "Служебные", visibility="staff")
    await library.import_games(db_session, staff, library.read_text(
        '[White "Secret"]\n[Black "X"]\n[Result "1-0"]\n\n1. d4 d5 1-0\n'))
    test_user_2.is_moderator = True
    await db_session.commit()
    return {"public": public.id, "private": private.id, "stats": stats, "again": again}


async def test_import_merges_duplicates(seeded):
    assert (seeded["stats"].added, seeded["stats"].linked) == (3, 3)
    assert (seeded["again"].added, seeded["again"].duplicates, seeded["again"].linked) == (0, 3, 0)


async def test_collections_tree_and_visibility(client, seeded, token_user_1, token_user_2):
    names = lambda body: sorted(c["name"] for c in body["collections"])  # noqa: E731
    guest = client.get(f"{API}/collections").json()
    assert names(guest) == ["Классика", "Партии"]
    by_name = {c["name"]: c for c in guest["collections"]}
    assert by_name["Классика"]["parent_id"] == by_name["Партии"]["id"] and by_name["Классика"]["games"] == 3
    assert names(client.get(f"{API}/collections", headers=auth(token_user_1)).json()) == ["Классика", "Личные", "Партии"]
    assert names(client.get(f"{API}/collections", headers=auth(token_user_2)).json()) == ["Классика", "Партии", "Служебные"]
    hidden = client.get(f"{API}/collections/{seeded['private']}/games", headers=auth(token_user_2))
    assert hidden.status_code == 404 and hidden.json()["detail"]["code"] == "library_collection_not_found"


async def test_collection_games_search_and_pgn(client, seeded, token_user_2):
    listed = client.get(f"{API}/collections/{seeded['public']}/games").json()
    assert listed["total"] == 3 and [g["white"] for g in listed["games"]] == ["Botvinnik", "Anon", "Broken"]
    assert client.get(f"{API}/games", params={"player": "euw"}).json()["total"] == 1
    assert client.get(f"{API}/games", params={"eco": "c", "result": "1-0"}).json()["games"][0]["white"] == "Anon"
    assert client.get(f"{API}/games", params={"year_from": 1900, "year_to": 1950}).json()["total"] == 1
    assert client.get(f"{API}/games", params={"max_plies": 4}).json()["total"] == 1
    assert client.get(f"{API}/games", params={"player": "secret"}).json()["total"] == 0
    assert client.get(f"{API}/games", params={"structure": "isolated_pawn"}).json()["total"] == 0  # таск 27.5
    # Метка «миниатюра» (27.5): решающие партии до 25 ходов; незаконченная «Broken» и скрытая «Secret» — нет.
    minis = client.get(f"{API}/games", params={"miniature": "true"}).json()
    assert minis["total"] == 2 and {g["white"] for g in minis["games"]} == {"Botvinnik", "Anon"}
    by_moves = client.get(f"{API}/games", params={"moves": "e2e4 e7e5 d1h5"}).json()  # таск 27.10
    assert [g["white"] for g in by_moves["games"]] == ["Anon"]
    assert client.get(f"{API}/games", params={"moves": "e2e4 e7e"}).json()["total"] == 0  # только целые ходы
    assert client.get(f"{API}/games", params={"moves": "e2e4%"}).status_code == 422
    assert listed["games"][0]["structure"] is None  # короткие партии — без структуры
    assert client.get(f"{API}/games", params={"player": "secret"}, headers=auth(token_user_2)).json()["total"] == 1

    game_id = listed["games"][0]["id"]
    full = client.get(f"{API}/games/{game_id}").json()
    assert full["moves"][:2] == ["c2c4", "c7c6"] and [c["name"] for c in full["collections"]] == ["Классика"]
    pgn = client.get(f"{API}/games/{game_id}/pgn").text
    assert '[White "Botvinnik"]' in pgn and "comment" not in pgn and "1. c4 c6 2. e4 d5 3. exd5 cxd5 0-1" in pgn
    secret = client.get(f"{API}/games", params={"player": "secret"}, headers=auth(token_user_2)).json()["games"][0]["id"]
    missing = client.get(f"{API}/games/{secret}/pgn")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "library_game_not_found"
