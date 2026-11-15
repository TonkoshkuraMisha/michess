# --- FILE: tests/test_study_room.py ---
"""Совместный разбор (таск 17.3): доска ведущего, опрос по версии, чат, вопрос с ответами, материалы клуба."""

API = "/api/v1/study"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_host_board_and_polling(client, token_user_1, token_user_2):
    created = client.post(API, headers=auth(token_user_1)).json()
    code = created["code"]
    assert created["is_host"] is True
    first = client.get(f"{API}/{code}", headers=auth(token_user_2)).json()
    assert first["is_host"] is False and first["board"]["fen"].startswith("rnbqkbnr")
    assert client.get(f"{API}/{code}", params={"since": first["version"]}, headers=auth(token_user_2)).status_code == 204

    board = {"fen": AFTER_E4, "last_move": "e2e4", "arrows": [{"from": "e7", "to": "e5", "color": "red"},
                                                              {"from": "zz", "to": "e5"}],
             "highlights": [{"square": "d5", "tone": "dark"}], "ghost": {"square": "f6", "piece": "bN"}}
    foreign = client.put(f"{API}/{code}/board", json=board, headers=auth(token_user_2)).json()
    assert foreign["detail"]["code"] == "study_host_only"
    updated = client.put(f"{API}/{code}/board", json=board, headers=auth(token_user_1)).json()
    assert updated["board"]["arrows"] == [{"from": "e7", "to": "e5", "color": "red"}]   # неверная стрелка отброшена
    seen = client.get(f"{API}/{code}", params={"since": first["version"]}, headers=auth(token_user_2)).json()
    assert seen["board"]["fen"] == AFTER_E4 and seen["board"]["ghost"] == {"square": "f6", "piece": "bN"}
    assert "player2" in seen["participants"]
    bad = client.put(f"{API}/{code}/board", json={"fen": "8/8/8/8/8/8/8/8 w - - 0 1"}, headers=auth(token_user_1))
    assert bad.json()["detail"]["code"] == "study_bad_position"


def test_chat_and_questions(client, token_user_1, token_user_2):
    code = client.post(API, headers=auth(token_user_1)).json()["code"]
    chat = client.post(f"{API}/{code}/chat", json={"text": "  Почему   не d4? "}, headers=auth(token_user_2)).json()
    assert chat["chat"][-1] == {"from": "player2", "text": "Почему не d4?", "at": chat["chat"][-1]["at"]}

    bad = client.post(f"{API}/{code}/question", json={"kind": "move", "correct": ["e2e5"]}, headers=auth(token_user_1))
    assert bad.json()["detail"]["code"] == "study_bad_question"
    asked = client.post(f"{API}/{code}/question", json={"kind": "move", "prompt": "Ваш ход?", "correct": ["e2e4", "d2d4"],
                                                         "seconds": 30}, headers=auth(token_user_1)).json()
    assert asked["question"]["correct"] == ["e2e4", "d2d4"]                      # ведущий видит ответ
    student_view = client.get(f"{API}/{code}", headers=auth(token_user_2)).json()
    assert "correct" not in student_view["question"]                              # ученик — нет
    answered = client.post(f"{API}/{code}/answer", json={"answer": "d2d4"}, headers=auth(token_user_2)).json()
    assert answered["my_answer"] == "d2d4"
    again = client.post(f"{API}/{code}/answer", json={"answer": "e2e4"}, headers=auth(token_user_2))
    assert again.json()["detail"]["code"] == "study_question_closed"
    host = client.get(f"{API}/{code}", headers=auth(token_user_1)).json()
    assert list(host["answers"].values())[0]["correct"] is True
    revealed = client.post(f"{API}/{code}/reveal", headers=auth(token_user_1)).json()
    assert revealed["question"]["revealed"] is True
    assert client.get(f"{API}/{code}", headers=auth(token_user_2)).json()["question"]["correct"] == ["e2e4", "d2d4"]

    choice = client.post(f"{API}/{code}/question", json={"kind": "choice", "options": ["Вилка", "Связка"], "correct": 1},
                         headers=auth(token_user_1)).json()
    assert choice["answers"] == {}                                                 # новый вопрос — ответы сброшены


def test_missing_room(client, token_user_1):
    assert client.get(f"{API}/nope1234", headers=auth(token_user_1)).status_code == 404


def test_materials(client, token_user_1, token_user_2):
    lesson = {"steps": [{"type": "text", "fen": AFTER_E4, "text": {"en": "a", "uk": "a", "ru": "a"}}]}
    saved = client.post(f"{API}/materials", json={"title": " Разбор  e4 ", "lesson": lesson}, headers=auth(token_user_1))
    assert saved.status_code == 201 and saved.json()["title"] == "Разбор e4"
    listed = client.get(f"{API}/materials", headers=auth(token_user_1)).json()["materials"]
    assert [m["title"] for m in listed] == ["Разбор e4"]
    assert client.get(f"{API}/materials/{saved.json()['id']}", headers=auth(token_user_1)).json()["lesson"] == lesson
    assert client.get(f"{API}/materials/{saved.json()['id']}", headers=auth(token_user_2)).status_code == 404
    empty = client.post(f"{API}/materials", json={"title": "x", "lesson": {"steps": []}}, headers=auth(token_user_1))
    assert empty.json()["detail"]["code"] == "study_bad_material"
