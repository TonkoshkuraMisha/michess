# --- FILE: tests/test_coach_cards.py ---
"""
«Клубный тренер» после партии (задача 5 плана 18.11, src/services/coach_cards.py): через настоящий запрос
GET /learn/after-game/{id} — самая дорогая личная задача партии без решения, отклонение от репертуара, темы ошибки
для урока; чужая и незаконченная партия — 404. Плюс чистое правило выбора отклонения.
"""

import pytest

from src.models.game import Game, GameStatus
from src.models.puzzle import PersonalPuzzle
from src.services.coach_cards import pick_deviation

API = "/api/v1/learn/after-game"
FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def games(db_session, test_user_1, test_user_2):
    done = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.COMPLETED,
                result="1-0", pgn="1. e4 e5 2. Nf3 Nc6 3. Bc4 1-0\n", analysis_json='{"moves": []}')
    live = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id, status=GameStatus.IN_PROGRESS,
                pgn="1. e4 e5\n")
    db_session.add_all([done, live])
    await db_session.flush()
    for ply, loss, themes in ((5, 180, "fork,fork_knight"), (9, 420, "pin,hanging_piece")):
        db_session.add(PersonalPuzzle(user_id=test_user_1.id, game_id=done.id, ply=ply, fen=FEN, previous_move="f1c4",
                                      solution="g8f6", played="f8c5", cp_loss=loss, themes=themes))
    await db_session.commit()
    return {"done": done.id, "live": live.id}


async def test_cards_after_a_finished_game(client, games, token_user_1, token_user_2):
    rep = client.post("/api/v1/repertoires", headers=auth(token_user_1), json={"color": "white", "name": "Ruy"}).json()
    client.post(f"/api/v1/repertoires/{rep['id']}/lines", headers=auth(token_user_1),
                json={"moves": ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]})

    body = client.get(f"{API}/{games['done']}", headers=auth(token_user_1)).json()
    assert body["game_id"] == games["done"] and body["analysed"] is True
    # Самая дорогая ошибка (потеря 420) — и задача, и темы урока; решение не уходит клиенту.
    assert body["puzzle"]["ply"] == 9 and "solution" not in body["puzzle"]
    assert body["lesson_themes"] == ["pin", "hanging_piece"]
    assert (body["deviation"]["kind"], body["deviation"]["played"], body["deviation"]["expected"]) == \
        ("you_left", "Bc4", ["Bb5"])

    # Соперник: своих задач и репертуаров нет — пустые карточки, но партия своя.
    other = client.get(f"{API}/{games['done']}", headers=auth(token_user_2)).json()
    assert (other["puzzle"], other["deviation"], other["lesson_themes"]) == (None, None, [])


async def test_only_own_finished_games(client, games, token_user_1):
    assert client.get(f"{API}/{games['live']}", headers=auth(token_user_1)).status_code == 404
    assert client.get(f"{API}/999999", headers=auth(token_user_1)).status_code == 404
    assert client.get(f"{API}/{games['done']}").status_code == 401


def test_pick_deviation_prefers_own_mistake_then_the_earliest():
    results = [{"kind": "end", "ply": 12}, {"kind": "opponent_new", "ply": 3}, {"kind": "you_left", "ply": 9},
               {"kind": "you_left", "ply": 7}]
    assert pick_deviation(results) == {"kind": "you_left", "ply": 7}
    assert pick_deviation([{"kind": "opponent_new", "ply": 5}]) == {"kind": "opponent_new", "ply": 5}
    assert pick_deviation([{"kind": "end", "ply": 4}, {"kind": "followed", "ply": 20}]) is None
