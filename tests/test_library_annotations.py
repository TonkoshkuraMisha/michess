"""Аннотации партий библиотеки (таск 27.4): auto и approved видны всем, черновики — только модераторам."""

from sqlalchemy import select

from src.models.library import LibraryAnnotation, LibraryGame
from src.services import library

API = "/api/v1/library"
PGN = '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'
COMMENTS = {"6": {"comment": [{"key": "coach.verdict.blunder.v1", "params": {"move": "Nf6"}}], "arrows": []}}


async def _game(db_session, status: str) -> int:
    collection = await library.ensure_collection(db_session, "Красивые партии")
    await library.import_games(db_session, collection, library.read_text(PGN))
    game = (await db_session.execute(select(LibraryGame))).scalars().first()
    db_session.add(LibraryAnnotation(game_id=game.id, status=status, body={"evals": [0] * 7, "comments": COMMENTS}))
    await db_session.commit()
    return game.id


async def test_auto_annotation_is_public(client, db_session):
    game_id = await _game(db_session, "auto")
    body = client.get(f"{API}/games/{game_id}").json()
    assert body["annotation"]["status"] == "auto" and body["annotation"]["comments"] == COMMENTS


async def test_draft_is_for_moderators_only(client, db_session, test_user_2, token_user_1, token_user_2):
    game_id = await _game(db_session, "draft")
    test_user_2.is_moderator = True
    await db_session.commit()
    assert client.get(f"{API}/games/{game_id}").json()["annotation"] is None
    player = client.get(f"{API}/games/{game_id}", headers={"Authorization": f"Bearer {token_user_1}"}).json()
    assert player["annotation"] is None
    seen = client.get(f"{API}/games/{game_id}", headers={"Authorization": f"Bearer {token_user_2}"}).json()
    assert seen["annotation"]["status"] == "draft"


async def test_game_without_annotation(client, db_session):
    collection = await library.ensure_collection(db_session, "Партии")
    await library.import_games(db_session, collection, library.read_text(PGN))
    game = (await db_session.execute(select(LibraryGame))).scalars().first()
    assert client.get(f"{API}/games/{game.id}").json()["annotation"] is None
