"""Дебютный репертуар (таск 20.1): стартовые наборы, линии из UCI и PGN, перестановки, комментарии, удаление веток."""

import chess

from src.services import openings, repertoire
from src.services.repertoire_starters import STARTERS

API = "/api/v1/repertoires"
E4_E5 = ["e2e4", "e7e5", "g1f3", "b8c6"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create(client, token, **body) -> dict:
    response = client.post(API, headers=auth(token), json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_starters_are_consistent():
    """Восемь наборов: белыми и чёрными, три уровня; ходы легальны, свой ход в позиции один, у линии есть дебют."""
    assert len(STARTERS) == 8
    assert {(s.color, s.level) for s in STARTERS} == {
        (c, lvl) for c in ("white", "black") for lvl in ("beginner", "intermediate", "advanced")}
    assert {s.style for s in STARTERS} == {"attacking", "positional"}
    for starter in STARTERS:
        own: dict[str, str] = {}
        side = chess.WHITE if starter.color == "white" else chess.BLACK
        for line in starter.lines:
            board = chess.Board()
            moves = []
            for uci in repertoire.san_line_to_uci(line):
                move = chess.Move.from_uci(uci)
                if board.turn == side:
                    assert own.setdefault(board.epd(), uci) == uci, (starter.id, line)
                board.push(move)
                moves.append(move)
            assert len(moves) <= repertoire.MAX_LINE_PLIES
            assert openings.classify_board_line(chess.Board(), moves) is not None, (starter.id, line)


def test_starters_endpoint_is_public(client):
    data = client.get(f"{API}/starters").json()["starters"]
    assert [s["id"] for s in data] == [s.id for s in STARTERS]
    assert data[0]["lines"][0][:2] == ["e2e4", "e7e5"]


def test_create_from_starter_and_tree(client, token_user_1):
    rep = create(client, token_user_1, starter="caro_kann", color="white")
    assert rep["color"] == "black" and rep["starter"] == "caro_kann"
    assert rep["moves"][0] == {"position": repertoire.ROOT, "uci": "e2e4", "san": "e4", "child": rep["moves"][0]["child"],
                               "comment": "", "mine": False}
    after_e4 = [m for m in rep["moves"] if m["position"] == rep["moves"][0]["child"]]
    assert [(m["san"], m["mine"]) for m in after_e4] == [("c6", True)]
    listed = client.get(API, headers=auth(token_user_1)).json()["repertoires"]
    assert listed == [{"id": rep["id"], "name": "", "color": "black", "starter": "caro_kann", "moves": len(rep["moves"])}]


def test_add_line_transposition_and_comment(client, token_user_1):
    rep = create(client, token_user_1, name="Mine", color="white")
    added = client.post(f"{API}/{rep['id']}/lines", headers=auth(token_user_1), json={"moves": E4_E5}).json()
    assert added["added"] == 4
    again = client.post(f"{API}/{rep['id']}/lines", headers=auth(token_user_1),
                        json={"moves": ["g1f3", "b8c6", "e2e4", "e7e5"]}).json()
    assert again["added"] == 4
    # Обе линии сходятся в одну позицию: из неё рёбер нет, а позиция-ребёнок у двух ходов одна.
    board = chess.Board()
    for uci in E4_E5:
        board.push_uci(uci)
    assert sorted(m["san"] for m in again["moves"] if m["child"] == board.epd()) == ["Nc6", "e5"]
    first = again["moves"][0]
    ok = client.put(f"{API}/{rep['id']}/comment", headers=auth(token_user_1),
                    json={"position": first["position"], "uci": first["uci"], "comment": " main idea "})
    assert ok.json() == {"comment": "main idea"}
    assert client.get(f"{API}/{rep['id']}", headers=auth(token_user_1)).json()["moves"][0]["comment"] == "main idea"


def test_illegal_line_rejected(client, token_user_1):
    rep = create(client, token_user_1)
    bad = client.post(f"{API}/{rep['id']}/lines", headers=auth(token_user_1), json={"moves": ["e2e4", "e2e4"]})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "illegal_move"
    assert client.get(f"{API}/{rep['id']}", headers=auth(token_user_1)).json()["moves"] == []


def test_pgn_import_with_variations(client, token_user_1):
    rep = create(client, token_user_1, color="black")
    pgn = '[Event "x"]\n\n1. e4 c6 (1... e5 2. Nf3 Nc6) 2. d4 d5 *\n\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n\n1. Kb2 *'
    data = client.post(f"{API}/{rep['id']}/pgn", headers=auth(token_user_1), json={"pgn": pgn}).json()
    assert data["added"] == 7
    assert sorted(m["san"] for m in data["moves"]) == ["Nc6", "Nf3", "c6", "d4", "d5", "e4", "e5"]
    junk = client.post(f"{API}/{rep['id']}/pgn", headers=auth(token_user_1), json={"pgn": "hello"})
    assert junk.status_code == 400 and junk.json()["detail"]["code"] == "repertoire_bad_pgn"


def test_remove_prunes_unreachable_but_keeps_transpositions(client, token_user_1):
    rep = create(client, token_user_1)
    url = f"{API}/{rep['id']}"
    client.post(f"{url}/lines", headers=auth(token_user_1), json={"moves": [*E4_E5, "f1c4"]})
    client.post(f"{url}/lines", headers=auth(token_user_1), json={"moves": ["g1f3", "b8c6", "e2e4", "e7e5"]})
    client.post(f"{url}/lines", headers=auth(token_user_1), json={"moves": ["d2d4", "d7d5"]})
    removed = client.post(f"{url}/remove", headers=auth(token_user_1),
                          json={"position": repertoire.ROOT, "uci": "e2e4"}).json()
    # Ушли 1.e4 e5 2.Nf3 Nc6 из начала; Bc4 остался — к нему ведёт перестановка через 1.Nf3.
    assert removed["removed"] == 4
    assert sorted(m["san"] for m in removed["moves"]) == ["Bc4", "Nc6", "Nf3", "d4", "d5", "e4", "e5"]
    removed = client.post(f"{url}/remove", headers=auth(token_user_1),
                          json={"position": repertoire.ROOT, "uci": "g1f3"}).json()
    assert removed["removed"] == 5
    assert sorted(m["san"] for m in removed["moves"]) == ["d4", "d5"]
    missing = client.post(f"{url}/remove", headers=auth(token_user_1), json={"position": repertoire.ROOT, "uci": "a2a3"})
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "repertoire_move_not_found"


def test_privacy_rename_delete_and_limits(client, token_user_1, token_user_2, monkeypatch):
    rep = create(client, token_user_1)
    url = f"{API}/{rep['id']}"
    assert client.get(url, headers=auth(token_user_2)).json()["detail"]["code"] == "repertoire_not_found"
    assert client.post(f"{url}/lines", headers=auth(token_user_2), json={"moves": E4_E5}).status_code == 404
    assert client.patch(url, headers=auth(token_user_1), json={"name": " London "}).json()["name"] == "London"
    assert client.post(API, json={}).status_code == 401
    unknown = client.post(API, headers=auth(token_user_1), json={"starter": "nope"})
    assert unknown.json()["detail"]["code"] == "repertoire_starter_not_found"

    monkeypatch.setattr(repertoire, "MAX_MOVES", 3)
    big = client.post(f"{url}/lines", headers=auth(token_user_1), json={"moves": E4_E5})
    assert big.json()["detail"] == {"code": "repertoire_too_large", "params": {"limit": 3},
                                    "message": "A repertoire can hold at most 3 moves"}
    monkeypatch.setattr(repertoire, "MAX_REPERTOIRES", 1)
    limit = client.post(API, headers=auth(token_user_1), json={})
    assert limit.json()["detail"]["code"] == "repertoire_limit"

    assert client.delete(url, headers=auth(token_user_1)).json() == {"deleted": True}
    assert client.get(API, headers=auth(token_user_1)).json() == {"repertoires": []}
