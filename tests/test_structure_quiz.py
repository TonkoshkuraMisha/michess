"""«Узнай структуру» (таск 27.9): позиции из размеченных партий библиотеки, скелеты как запас, варианты ответа."""

import random

import chess

from src.services import library
from src.services import pawn_structures as ps
from src.services import structure_quiz as sq

API = "/api/v1/library/structure-quiz"
FRENCH = "1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Bd7 7. b4 cxd4 8. cxd4 Rc8 9. Bb2 Nge7 " \
         "10. Nc3 Nf5 11. Na4 Qd8 12. Bd3 Be7 *"


def test_skeletons_are_recognised():
    for structure in ps.STRUCTURES:
        assert ps.detect(chess.Board(sq.skeleton_fen(structure))) == structure


def test_build_fills_with_skeletons_and_has_four_options():
    questions = sq.build([], 10, random.Random(1))
    assert len(questions) == 10
    assert len({q.answer for q in questions}) == 10  # разные структуры подряд
    for q in questions:
        assert len(q.options) == sq.OPTIONS and q.answer in q.options and len(set(q.options)) == sq.OPTIONS
        assert q.game_id is None


async def test_endpoint_uses_library_games(client, db_session):
    collection = await library.ensure_collection(db_session, "Структуры")
    await library.import_games(db_session, collection, library.read_text(FRENCH))
    await db_session.commit()
    body = client.get(API, params={"count": 3, "seed": 5}).json()
    assert len(body["questions"]) == 3
    from_game = [q for q in body["questions"] if q["game_id"] is not None]
    assert len(from_game) == 1 and from_game[0]["answer"] == "french_chain"
    assert ps.FIRST_PLY <= from_game[0]["ply"] <= ps.LAST_PLY
    assert ps.detect(chess.Board(from_game[0]["fen"])) == "french_chain"
    assert client.get(API, params={"count": 21}).status_code == 422
