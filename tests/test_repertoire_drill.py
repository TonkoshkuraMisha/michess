"""Повторение репертуара (таск 20.2): SM-2, карточки-позиции, дневная норма, сессии, ответы соперника."""

from datetime import UTC, datetime, timedelta

from src.models.repertoire import RepertoireCard
from src.services import repertoire
from src.services import repertoire_drill as drill

API = "/api/v1/repertoires"
NOW = datetime(2026, 11, 15, 12, tzinfo=UTC)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_sm2_schedule():
    card = RepertoireCard(ease=2.5, interval_days=0, repetitions=0, lapses=0)
    intervals = []
    for _ in range(3):
        drill.schedule(card, True, NOW)
        intervals.append(card.interval_days)
    assert intervals == [1, 6, 15] and card.ease == 2.5 and card.due_at == NOW + timedelta(days=15)
    drill.schedule(card, False, NOW)
    assert (card.interval_days, card.repetitions, card.lapses, round(card.ease, 2)) == (1, 0, 1, 1.96)
    for _ in range(5):
        drill.schedule(card, False, NOW)
    assert card.ease == drill.MIN_EASE
    assert drill.status(card) == "learning" and drill.status(RepertoireCard()) == "new"


def make(client, token, color="white", lines=(("e2e4", "e7e5", "g1f3"), ("e2e4", "c7c5", "g1f3"))) -> int:
    rep = client.post(API, headers=auth(token), json={"color": color}).json()
    for line in lines:
        client.post(f"{API}/{rep['id']}/lines", headers=auth(token), json={"moves": list(line)})
    return rep["id"]


def test_session_daily_norm_and_answers(client, token_user_1, monkeypatch):
    rep_id = make(client, token_user_1)
    monkeypatch.setattr(drill, "utcnow", lambda: NOW)
    monkeypatch.setattr(drill, "NEW_PER_DAY", 2)
    first = client.get(f"{API}/{rep_id}/drill", headers=auth(token_user_1)).json()
    assert first["stats"] == {"total": 3, "new": 3, "learning": 0, "learned": 0, "due": 0, "new_left": 2}
    cards = first["cards"]
    assert [c["line"] for c in cards] == [[], ["e2e4", "c7c5"]]  # короткие линии первыми, норма — 2
    assert cards[0]["answers"] == [{"uci": "e2e4", "san": "e4", "comment": ""}]
    assert cards[1]["fen"].startswith("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w")

    root = cards[0]["position"]
    good = client.post(f"{API}/{rep_id}/drill/answer", headers=auth(token_user_1),
                       json={"position": root, "uci": "e2e4"}).json()
    assert good["correct"] is True and good["status"] == "learning"
    assert good["due_at"].startswith("2026-11-16") and good["stats"]["new_left"] == 1

    other = cards[1]["position"]
    bad = client.post(f"{API}/{rep_id}/drill/answer", headers=auth(token_user_1),
                      json={"position": other, "uci": "d2d4"}).json()
    assert bad["correct"] is False and bad["answers"][0]["san"] == "Nf3"
    retry = client.post(f"{API}/{rep_id}/drill/answer", headers=auth(token_user_1),
                        json={"position": other, "uci": "g1f3", "retry": True}).json()
    assert retry["correct"] is True and retry["due_at"] == bad["due_at"]  # повтор не меняет расписание

    # Норма на сегодня исчерпана: в повторении нет ни новых, ни просроченных.
    assert client.get(f"{API}/{rep_id}/drill", headers=auth(token_user_1)).json()["cards"] == []
    # «Учить новые» — без нормы.
    learn = client.get(f"{API}/{rep_id}/drill", params={"mode": "learn"}, headers=auth(token_user_1)).json()
    assert [c["line"] for c in learn["cards"]] == [["e2e4", "e7e5"]]

    # Завтра обе отвеченные карточки — к повторению.
    monkeypatch.setattr(drill, "utcnow", lambda: NOW + timedelta(days=1, hours=1))
    tomorrow = client.get(f"{API}/{rep_id}/drill", headers=auth(token_user_1)).json()
    assert tomorrow["stats"]["due"] == 2
    assert {c["position"] for c in tomorrow["cards"][:2]} == {root, other}

    missing = client.post(f"{API}/{rep_id}/drill/answer", headers=auth(token_user_1),
                          json={"position": "nope", "uci": "e2e4"})
    assert missing.status_code == 404


def test_cards_follow_the_tree(client, token_user_1):
    rep_id = make(client, token_user_1)
    client.get(f"{API}/{rep_id}/drill", headers=auth(token_user_1))
    after_e4 = [m for m in client.get(f"{API}/{rep_id}", headers=auth(token_user_1)).json()["moves"]
                if m["uci"] == "c7c5"][0]
    client.post(f"{API}/{rep_id}/remove", headers=auth(token_user_1),
                json={"position": after_e4["position"], "uci": "c7c5"})
    stats = client.get(f"{API}/{rep_id}/drill", headers=auth(token_user_1)).json()["stats"]
    assert stats["total"] == 2
    assert client.delete(f"{API}/{rep_id}", headers=auth(token_user_1)).json() == {"deleted": True}


def test_opponent_replies_from_repertoire(client, token_user_1, token_user_2):
    rep_id = make(client, token_user_1, color="black",
                  lines=(("e2e4", "c7c6", "d2d4", "d7d5"), ("e2e4", "c7c6", "g1f3", "d7d5"), ("d2d4", "d7d5")))
    first = client.post(f"{API}/{rep_id}/opponent", headers=auth(token_user_1), json={"moves": []}).json()
    assert first["reply"] in ("e2e4", "d2d4")
    second = client.post(f"{API}/{rep_id}/opponent", headers=auth(token_user_1), json={"moves": ["e2e4", "c7c6"]}).json()
    assert second["reply"] in ("d2d4", "g1f3")
    done = client.post(f"{API}/{rep_id}/opponent", headers=auth(token_user_1),
                       json={"moves": ["e2e4", "c7c6", "d2d4", "d7d5"]}).json()
    assert done == {"reply": None, "san": None}
    own_turn = client.post(f"{API}/{rep_id}/opponent", headers=auth(token_user_1), json={"moves": ["e2e4"]})
    assert own_turn.status_code == 400 and own_turn.json()["detail"]["code"] == "illegal_move"
    assert client.post(f"{API}/{rep_id}/opponent", headers=auth(token_user_2), json={"moves": []}).status_code == 404


def test_spots_shortest_line_via_transposition():
    rows = []
    for line in (("e2e4", "e7e5", "g1f3", "b8c6", "f1c4"), ("g1f3", "b8c6", "e2e4", "e7e5")):
        for position, uci in repertoire.parse_line(list(line)):
            rows.append(type("Row", (), {"id": len(rows), "position": position, "move_uci": uci, "comment": ""})())
    rep = type("Rep", (), {"color": "white"})()
    found = drill.spots(rep, repertoire.build_tree("white", rows))  # type: ignore[arg-type]
    # Позиция перед Bc4 достижима двумя путями — карточка одна, линия к ней — первая найденная обходом в ширину.
    bc4 = [s for s in found.values() if s.answers[0]["san"] == "Bc4"]
    assert len(bc4) == 1 and len(bc4[0].line) == 4
