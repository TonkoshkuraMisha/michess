# --- FILE: tests/test_explorer_library.py ---
"""
Партии библиотеки в справочнике дебютов (8б): индекс позиций библиотеки при импорте, примеры под позицией только из
публичных коллекций, повтор архивной партии в библиотеке (те же фамилии и год) показывается один раз — партией
библиотеки; статистика ходов от партий библиотеки не меняется.
"""

import pytest
from sqlalchemy import func, select

from src.models.game import Game, GameStatus
from src.models.library import LibraryAnnotation, LibraryGame
from src.models.position import PositionLibraryGame
from src.models.user import User
from src.services import library, position_index
from src.services.opening_explorer import ARCHIVE_PASSWORD, merge_examples, player_key

API = "/api/v1/analysis/opening-explorer"

# Та же партия, что в архиве ниже (Морфи — Андерсен, 1858), плюс партия, которой в архиве нет.
PUBLIC_PGN = """[White "Morphy, Paul"]
[Black "Anderssen, Adolf"]
[Date "1858.12.20"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0

[White "Steinitz, Wilhelm"]
[Black "Zukertort, Johannes"]
[Date "1886.01.11"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 0-1
"""
PRIVATE_PGN = """[White "Someone, Private"]
[Black "Other, Private"]
[Date "1990.01.01"]
[Result "1-0"]

1. e4 e5 2. Qh5 1-0
"""


def test_player_key_takes_the_surname():
    assert player_key("Lasker, Emanuel") == "lasker"
    assert player_key("Emanuel Lasker") == "lasker"
    assert player_key("  ") == ""


def test_merge_keeps_the_library_copy_of_a_duplicate():
    archive = [{"id": 1, "white": "Morphy, Paul", "black": "Anderssen, Adolf", "year": "1858", "source": "archive"},
               {"id": 2, "white": "Morphy, P.", "black": "Anderssen, A.", "year": "1859", "source": "archive"},
               {"id": 3, "white": "Unknown", "black": "Player", "year": None, "source": "archive"}]
    library_rows = [{"id": 10, "white": "Paul Morphy", "black": "Adolf Anderssen", "year": "1858", "source": "library"}]
    merged = merge_examples(archive, library_rows)
    assert [(g["source"], g["id"]) for g in merged] == [("archive", 2), ("library", 10), ("archive", 3)]


@pytest.fixture
async def explorer_data(db_session, test_user_1):
    morphy = User(username="Morphy, Paul", hashed_password=ARCHIVE_PASSWORD)
    anderssen = User(username="Anderssen, Adolf", hashed_password=ARCHIVE_PASSWORD)
    db_session.add_all([morphy, anderssen])
    await db_session.flush()
    archived = Game(white_player_id=morphy.id, black_player_id=anderssen.id, status=GameStatus.COMPLETED, result="1-0",
                    pgn='[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0\n', pgn_date="1858.12.20")
    db_session.add(archived)
    await db_session.flush()
    await position_index.index_game(db_session, archived)

    public = await library.ensure_collection(db_session, "Классика")
    await library.import_games(db_session, public, library.read_text(PUBLIC_PGN))
    private = await library.ensure_collection(db_session, "Личные", visibility="owner", owner_id=test_user_1.id)
    await library.import_games(db_session, private, library.read_text(PRIVATE_PGN))
    steinitz = await db_session.scalar(select(LibraryGame).where(LibraryGame.white == "Steinitz, Wilhelm"))
    db_session.add(LibraryAnnotation(game_id=steinitz.id, status="approved", body={"evals": [], "comments": []}))
    await db_session.commit()
    return {"archived": archived.id, "steinitz": steinitz.id}


async def test_import_indexes_library_positions(db_session, explorer_data):
    rows = await db_session.scalar(select(func.count()).select_from(PositionLibraryGame))
    assert rows == 5 + 5 + 3  # первые позиции каждой партии: 5, 5 и 3 полухода
    assert await db_session.scalar(select(func.count()).select_from(LibraryGame)
                                   .where(LibraryGame.positions_indexed.is_(False))) == 0


async def test_explorer_shows_library_games_once_and_only_public(client, explorer_data):
    body = client.post(API, json={"moves": ["e2e4", "e7e5"]}).json()
    games = [(g["source"], g["white"], g["year"]) for g in body["games"]]
    # Морфи — Андерсен 1858 есть и в архиве, и в библиотеке: остаётся библиотечная; частная коллекция не видна.
    assert games == [("library", "Steinitz, Wilhelm", "1886"), ("library", "Morphy, Paul", "1858")]
    assert body["games"][0]["annotated"] is True and body["games"][0]["id"] == explorer_data["steinitz"]
    # Статистика — только партия архива: партии библиотеки в неё не входят.
    assert [(m["san"], m["games"]) for m in body["moves"]] == [("Nf3", 1)]


async def test_reindex_is_idempotent(db_session, explorer_data):
    game = await db_session.get(LibraryGame, explorer_data["steinitz"])
    assert await position_index.index_library_game(db_session, game) is False
