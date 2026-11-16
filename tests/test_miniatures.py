"""«Миниатюры» (таск 27.9): короткие партии с матом на доске, позиция перед последним ходом."""

import random

import chess

from src.services import library
from src.services import miniatures as mini

API = "/api/v1/library/miniatures"
PGN = """[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[White "C"]
[Black "D"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"""


def test_miniature_needs_mate_on_board():
    m = mini.miniature(1, "e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7")
    assert m is not None and m.answer == "h5f7" and len(m.moves) == 6
    assert chess.Board(m.fen).turn == chess.WHITE
    assert mini.miniature(2, "e2e4 e7e5 g1f3") is None  # сдача без мата
    assert mini.miniature(3, " ".join(["g1f3", "g8f6", "f3g1", "f6g8"] * 13)) is None  # длиннее 25 ходов
    assert mini.pick([(1, "e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7")], 5, random.Random(0))[0].game_id == 1


async def test_endpoint(client, db_session):
    collection = await library.ensure_collection(db_session, "Миниатюры")
    await library.import_games(db_session, collection, library.read_text(PGN))
    await db_session.commit()
    body = client.get(API, params={"count": 5, "seed": 1}).json()
    assert len(body["miniatures"]) == 1
    item = body["miniatures"][0]
    assert (item["white"], item["answer"], len(item["moves"])) == ("A", "h5f7", 6)
