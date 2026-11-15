# --- FILE: tests/test_opening_explorer.py ---
"""Справочник дебютов (таск 16.2): ходы со статистикой, название дебюта, партии мастеров только из архива."""

import pytest

from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import position_index
from src.services.game_state import state_manager
from src.services.opening_explorer import ARCHIVE_PASSWORD

API = "/api/v1/analysis/opening-explorer"


@pytest.fixture
async def indexed(db_session, test_user_1, test_user_2):
    morphy = User(username="Morphy, Paul", hashed_password=ARCHIVE_PASSWORD)
    anderssen = User(username="Anderssen, Adolf", hashed_password=ARCHIVE_PASSWORD)
    db_session.add_all([morphy, anderssen])
    await db_session.flush()
    games = [
        (morphy, anderssen, "1. e4 e5 2. Nf3 Nc6 3. Bb5", "1-0", "1858.12.20"),
        (anderssen, morphy, "1. e4 e5 2. Nf3 Nc6 3. Bc4", "0-1", "1858.12.27"),
        (morphy, anderssen, "1. e4 c5", "1/2-1/2", "1859.01.01"),
        (test_user_1, test_user_2, "1. e4 e5 2. Nf3 Nc6 3. Bb5", "1-0", None),  # игроки клуба — в статистике, не в «мастерах»
    ]
    for white, black, moves, result, date in games:
        game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED, result=result,
                    pgn=f'[Result "{result}"]\n\n{moves} {result}\n', pgn_date=date)
        db_session.add(game)
        await db_session.flush()
        await position_index.index_game(db_session, game)
    await db_session.commit()


async def test_moves_with_statistics_and_opening_names(client, indexed):
    body = client.post(API, json={"moves": ["e2e4", "e7e5", "g1f3", "b8c6"]}).json()
    assert body["opening"]["name"].startswith("King's Knight Opening")
    moves = {m["san"]: m for m in body["moves"]}
    assert list(moves) == ["Bb5", "Bc4"]  # от частого к редкому
    assert (moves["Bb5"]["games"], moves["Bb5"]["white_wins"]) == (2, 2)
    assert moves["Bb5"]["opening"]["name"] == "Ruy Lopez"
    assert (moves["Bc4"]["black_wins"], moves["Bc4"]["opening"]["eco"]) == (1, "C50")


async def test_master_games_come_only_from_the_archive(client, indexed):
    body = client.post(API, json={"moves": ["e2e4"]}).json()
    assert [g["year"] for g in body["games"]] == ["1859", "1858", "1858"]
    assert {g["white"] for g in body["games"]} == {"Morphy, Paul", "Anderssen, Adolf"}
    start = client.post(API, json={"moves": []}).json()
    assert start["opening"] is None and start["moves"][0] == {
        "uci": "e2e4", "san": "e4", "games": 4, "white_wins": 2, "draws": 1, "black_wins": 1,
        "opening": {"eco": "B00", "name": "King's Pawn Game"},
    }


async def test_unknown_position_and_illegal_moves(client, indexed):
    empty = client.post(API, json={"moves": ["h2h4"]}).json()
    assert empty["moves"] == [] and empty["games"] == []
    bad = client.post(API, json={"moves": ["e2e5"]})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "illegal_move"


async def test_explorer_is_closed_during_a_game_with_a_person(client, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=612, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(API, json={"moves": []}, headers={"Authorization": f"Bearer {token_user_1}"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "engine_locked_in_game"
