"""Отклонения от репертуара в партиях (таск 20.3): свой ход не тот, новый ход соперника, конец линии, перестановки."""

import chess
import pytest

from src.models.game import Game, GameStatus
from src.services import repertoire
from src.services import repertoire_deviations as deviations

API = "/api/v1/repertoires"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def tree(color: str, *lines: str):
    rows = []
    for line in lines:
        board = chess.Board()
        ucis = []
        for san in line.split():
            ucis.append(board.push_san(san).uci())
        for position, uci in repertoire.parse_line(ucis):
            rows.append(type("Row", (), {"id": len(rows), "position": position, "move_uci": uci, "comment": ""})())
    rep = type("Rep", (), {"color": color})()
    return rep, repertoire.build_tree(color, rows)


def game(line: str) -> list[chess.Move]:
    board = chess.Board()
    return [board.push_san(san) for san in line.split()]


def test_kinds_of_deviation():
    rep, edges = tree("white", "e4 e5 Nf3 Nc6 Bb5", "e4 c5 c3")
    left = deviations.find(rep, edges, game("e4 e5 Nf3 Nc6 Bc4 Bc5"))
    assert (left.kind, left.ply, left.played, left.expected) == ("you_left", 5, "Bc4", ["Bb5"])
    assert left.line == ["e2e4", "e7e5", "g1f3", "b8c6"] and left.played_uci == "f1c4"
    new = deviations.find(rep, edges, game("e4 e6 d4"))
    assert (new.kind, new.ply, new.played, sorted(new.expected)) == ("opponent_new", 2, "e6", ["c5", "e5"])
    end = deviations.find(rep, edges, game("e4 c5 c3 Nf6 e5"))
    assert (end.kind, end.ply) == ("end", 4)
    followed = deviations.find(rep, edges, game("e4 e5 Nf3"))
    assert (followed.kind, followed.ply) == ("followed", 3)
    assert deviations.find(rep, edges, game("d4 d5")).kind == "you_left"
    assert deviations.find(*tree("black", "e4 c6"), game("d4 d5")).kind == "opponent_new"


def test_transposition_is_recognised():
    rep, edges = tree("white", "d4 d5 Nf3 Nf6 c4", "d4 Nf6 Nf3 d5")
    found = deviations.find(rep, edges, game("d4 Nf6 Nf3 d5 c4 e6"))
    # Вторая линия кончается в позиции первой — партия идёт дальше по первой (c4) до конца подготовки.
    assert (found.kind, found.ply) == ("end", 6)


@pytest.fixture
async def games(db_session, test_user_1, test_user_2):
    def add(white, black, moves: str, status=GameStatus.COMPLETED) -> int:
        row = Game(white_player_id=white.id, black_player_id=black.id, status=status, result="1-0",
                   pgn=f"{moves} 1-0\n")
        db_session.add(row)
        return row

    done = add(test_user_1, test_user_2, "1. e4 e5 2. Nf3 Nc6 3. Bc4")
    live = add(test_user_1, test_user_2, "1. e4 e5", GameStatus.IN_PROGRESS)
    await db_session.commit()
    return {"done": done.id, "live": live.id}


async def test_api_deviations_and_focus(client, games, token_user_1, token_user_2, monkeypatch):
    rep = client.post(API, headers=auth(token_user_1), json={"color": "white", "name": "Испанская"}).json()
    client.post(f"{API}/{rep['id']}/lines", headers=auth(token_user_1),
                json={"moves": ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]})
    client.post(API, headers=auth(token_user_1), json={"starter": "caro_kann"})  # чёрные — не про эту партию

    body = client.get(f"{API}/game/{games['done']}/deviations", headers=auth(token_user_1)).json()
    assert body["color"] == "white" and len(body["results"]) == 1
    result = body["results"][0]
    assert (result["name"], result["kind"], result["ply"], result["played"], result["expected"]) == \
        ("Испанская", "you_left", 5, "Bc4", ["Bb5"])

    # Соперник смотрит свою партию — его репертуаров нет; чужой игрок и незаконченная партия — 404.
    assert client.get(f"{API}/game/{games['done']}/deviations", headers=auth(token_user_2)).json() == \
        {"color": "black", "results": []}
    assert client.get(f"{API}/game/{games['live']}/deviations", headers=auth(token_user_1)).status_code == 404

    focus = client.post(f"{API}/{rep['id']}/drill/focus", headers=auth(token_user_1),
                        json={"position": result["position"]})
    assert focus.json() == {"ok": True}
    review = client.get(f"{API}/{rep['id']}/drill", headers=auth(token_user_1)).json()
    assert review["cards"][0]["position"] == result["position"]  # просроченная карточка — первой
    assert client.post(f"{API}/{rep['id']}/drill/focus", headers=auth(token_user_1),
                       json={"position": "nope"}).status_code == 404
