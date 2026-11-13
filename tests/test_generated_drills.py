# --- FILE: tests/test_generated_drills.py ---
"""
Упражнения-генераторы (таск 13.7): у каждого упражнения ровно один верный ответ (перепроверка на итоговой, в том
числе зеркальной, позиции), ответ действительно делает то, что требует вид, генерация детерминирована; API выдачи и
проверки, мат в 2 в два хода, забег на минуту и личный рекорд.
"""

import chess
import pytest

from src.services import drill_generator as gen
from src.services import generated_drills as drills

SAMPLE = 4  # seed на сочетание в тестах (мат в 2 перебором — дорогой)
CASES = [(key, seed) for key, seeds in sorted(drills.seeds().items()) for seed in seeds[:SAMPLE]]
API = "/api/v1/puzzles"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_every_combination_has_seeds():
    expected = {f"{k}.{p}.{lv}" for k in gen.KINDS for p in gen.PIECES for lv in gen.LEVELS if gen.supported(k, p)}
    table = drills.seeds()
    assert set(table) == expected
    # Обычно 40 на сочетание; угроза мата конём с единственной защитой редка (13 на 400 тыс. seed) — минимум 10.
    assert all(len(seeds) >= 10 for seeds in table.values()), {k: len(v) for k, v in table.items() if len(v) < 10}
    assert sum(len(seeds) >= 40 for seeds in table.values()) >= len(table) - 3


@pytest.mark.parametrize(("key", "seed"), CASES, ids=[f"{k}-{s}" for k, s in CASES])
def test_single_correct_answer_that_does_what_the_kind_asks(key, seed):
    kind, piece, level = key.split(".")
    drill = gen.build(kind, piece, int(level), seed)
    assert drill is not None and drill == gen.build(kind, piece, int(level), seed)  # детерминированно
    board = chess.Board(drill.fen)
    assert board.is_valid() and not board.is_check()
    move = chess.Move.from_uci(drill.solutions[0])
    moved = board.piece_at(move.from_square)
    assert moved is not None and moved.color == board.turn
    if piece in gen.PIECE_TYPES and kind != "escape":
        assert moved.piece_type == gen.PIECE_TYPES[piece]

    # Перепроверка на итоговой позиции (после зеркалирования за чёрных): ответ один и тот же.
    key_square = move.from_square if kind == "safe" else None
    assert [m.uci() for m in gen.solutions_for(kind, board, key_square)] == list(drill.solutions)

    after = board.copy(stack=False)
    after.push(move)
    if kind == "capture":
        assert board.is_capture(move) and not board.is_attacked_by(not board.turn, move.to_square)
    elif kind == "fork":
        assert gen._targets(after, move.to_square, board.turn) >= 2
    elif kind == "check":
        assert after.is_check() and not after.is_attacked_by(after.turn, move.to_square)
    elif kind == "pin":
        assert any(gen._pinned_by(after, sq, move.to_square, after.turn)
                   for sq in chess.SquareSet(after.occupied_co[after.turn]))
    elif kind == "safe":
        assert board.is_attacked_by(not board.turn, move.from_square)
        assert not after.is_attacked_by(after.turn, move.to_square)
    elif kind == "escape":
        passing = board.copy(stack=False)
        passing.push(chess.Move.null())
        assert gen._has_mate_in_one(passing) is not None  # угроза мата есть
        assert gen._has_mate_in_one(after) is None  # и ход её снимает
    elif kind == "mate1":
        assert after.is_checkmate()
    elif kind == "mate2":
        line = drills.full_line(drill)
        final = board.copy(stack=False)
        for uci in line:
            final.push_uci(uci)
        assert len(line) == 3 and final.is_checkmate()


def test_unsupported_and_invalid_keys():
    assert not gen.supported("pin", "n")
    with pytest.raises(drills.PuzzleError):
        drills.combo("pin", "n", 1)
    with pytest.raises(drills.PuzzleError):
        drills.check("nonsense", ["e2e4"])


def _solve(key: str) -> list[str]:
    return drills.full_line(gen.restore(key))


async def test_api_one_move_drill(client, token_user_1):
    view = client.get(f"{API}/drills/next", params={"kind": "fork", "piece": "n", "level": 1},
                      headers=_auth(token_user_1)).json()
    assert {"key", "fen", "color", "kind", "piece", "level", "piece_type", "moves"} == set(view)
    assert view["piece_type"] == "n" and view["moves"] == 1
    right = _solve(view["key"])[0]
    body = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [right]},
                       headers=_auth(token_user_1)).json()
    assert body == {"correct": True, "done": True, "reply": None, "solution": None, "run": None}

    board = chess.Board(view["fen"])
    wrong = next(m.uci() for m in board.legal_moves if m.uci() != right)
    body = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [wrong]},
                       headers=_auth(token_user_1)).json()
    assert not body["correct"] and body["solution"] == [right]


async def test_api_mate_in_two(client, token_user_1):
    view = client.get(f"{API}/drills/next", params={"kind": "mate2", "piece": "r", "level": 1},
                      headers=_auth(token_user_1)).json()
    first, reply, mate = _solve(view["key"])
    step = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [first]},
                       headers=_auth(token_user_1)).json()
    assert step == {"correct": True, "done": False, "reply": reply, "solution": None, "run": None}
    done = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [first, reply, mate]},
                       headers=_auth(token_user_1)).json()
    assert done["correct"] and done["done"]
    # Ответ соперника подменить нельзя.
    board = chess.Board(view["fen"])
    board.push_uci(first)
    other = next((m.uci() for m in board.legal_moves if m.uci() != reply), None)
    if other:
        cheat = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [first, other, mate]},
                            headers=_auth(token_user_1))
        assert cheat.status_code == 409


async def test_api_errors(client, token_user_1):
    bad = client.get(f"{API}/drills/next", params={"kind": "pin", "piece": "n", "level": 1}, headers=_auth(token_user_1))
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "unknown_drill"
    view = client.get(f"{API}/drills/next", params={"kind": "check", "piece": "q", "level": 2},
                      headers=_auth(token_user_1)).json()
    illegal = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": ["a1a1"]}, headers=_auth(token_user_1))
    assert illegal.status_code == 400
    forged = client.post(f"{API}/drills/answer", json={"key": "check.q.2.999999999", "moves": ["e2e4"]},
                         headers=_auth(token_user_1))
    assert forged.status_code == 400
    assert client.get(f"{API}/drills/next", params={"kind": "check", "piece": "q", "level": 1}).status_code == 401


async def test_timed_run_counts_and_keeps_the_record(client, token_user_1):
    start = client.post(f"{API}/drills/run/start", json={"kind": "capture", "piece": "r", "level": 1},
                        headers=_auth(token_user_1)).json()
    assert start["combo"] == "capture.r.1" and start["solved"] == 0
    for _ in range(3):
        view = client.get(f"{API}/drills/run/next", headers=_auth(token_user_1)).json()
        body = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": _solve(view["key"]), "run": True},
                           headers=_auth(token_user_1)).json()
        assert body["correct"]
    assert body["run"]["solved"] == 3
    # Упражнение не из забега счёт не меняет.
    outside = client.get(f"{API}/drills/next", params={"kind": "capture", "piece": "r", "level": 1},
                         headers=_auth(token_user_1)).json()
    refused = client.post(f"{API}/drills/answer", json={"key": outside["key"], "moves": _solve(outside["key"]), "run": True},
                          headers=_auth(token_user_1))
    assert refused.status_code == 409
    result = client.post(f"{API}/drills/run/finish", headers=_auth(token_user_1)).json()
    assert result == {"combo": "capture.r.1", "score": 3, "mistakes": 0, "best": 3, "new_record": True}
    records = client.get(f"{API}/drills/records", headers=_auth(token_user_1)).json()
    assert records["records"] == {"capture.r.1": 3} and records["themes"]["fork"] == "fork"


async def test_timed_run_ends_after_three_mistakes(client, token_user_1):
    client.post(f"{API}/drills/run/start", json={"kind": "check", "piece": "b", "level": 1}, headers=_auth(token_user_1))
    for _ in range(3):
        view = client.get(f"{API}/drills/run/next", headers=_auth(token_user_1)).json()
        right = _solve(view["key"])[0]
        board = chess.Board(view["fen"])
        wrong = next(m.uci() for m in board.legal_moves if m.uci() != right)
        body = client.post(f"{API}/drills/answer", json={"key": view["key"], "moves": [wrong], "run": True},
                           headers=_auth(token_user_1)).json()
    assert body["run"]["mistakes"] == 3 and body["run"]["over"]
    over = client.get(f"{API}/drills/run/next", headers=_auth(token_user_1))
    assert over.status_code == 409 and over.json()["detail"]["code"] == "timed_run_over"
