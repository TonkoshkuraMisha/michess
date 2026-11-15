"""Любимые дебюты соперников мастерской (таск 21.2): поиск в таблице, проверка выбора, ходы по линии и перестановки."""

import chess
import pytest
from pydantic import ValidationError

from src.services import openings
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot, favorite_moves


def epd_of(name: str) -> str:
    return next(line.epd for line in openings.lines().values() if line.name == name)


RUY = epd_of("Ruy Lopez")
SICILIAN = epd_of("Sicilian Defense")


def board_after(*sans: str) -> chess.Board:
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def test_table_has_lines_and_search():
    line = openings.lines()[RUY]
    assert line.moves == ("e2e4", "e7e5", "g1f3", "b8c6", "f1b5") and line.eco == "C60"
    found = openings.search("sicilian")
    assert found[0].name == "Sicilian Defense" and len(found) == 20
    assert all(o.eco.startswith("C6") for o in openings.search("c6"))
    assert openings.search("  ") == []
    # Ходы каждой записи ведут в её позицию.
    for item in list(openings.lines().values())[::50]:
        board = chess.Board()
        for uci in item.moves:
            board.push_uci(uci)
        assert board.epd() == item.epd


def test_config_validation():
    config = BotPersonalityConfig(openings_white=[RUY, RUY], openings_black=[SICILIAN])
    assert config.openings_white == [RUY]  # повтор убирается
    with pytest.raises(ValidationError) as unknown:
        BotPersonalityConfig(openings_white=["nope"])
    assert unknown.value.errors()[0]["type"] == "bot_opening_unknown"
    with pytest.raises(ValidationError):
        BotPersonalityConfig(openings_black=[SICILIAN] * 4)
    assert BotPersonalityConfig.model_validate_json("{}").openings_white == []  # старые сохранённые — без дебютов


def test_bot_plays_its_lines_by_colour_and_transposition():
    bot = PersonalityBot(BotPersonalityConfig(openings_white=[RUY], openings_black=[SICILIAN]))
    first = bot._book_move(chess.Board())
    assert first[0].uci() == "e2e4" and first[1] == {"key": "personality.favoriteOpening", "params": {"name": "Ruy Lopez"}}
    assert bot._book_move(board_after("e4", "e5"))[0].uci() == "g1f3"
    assert bot._book_move(board_after("e4", "c5")) is None  # соперник свернул — дальше движок
    assert bot._book_move(board_after("e4"))[0].uci() == "c7c5"  # чёрными — свой чёрный дебют
    assert bot._book_move(board_after("d4")) is None
    # Перестановка ходов: 1.Nf3 Nc6 2.e4 e5 — та же позиция испанской, бот продолжает Bb5.
    assert bot._book_move(board_after("Nf3", "Nc6", "e4", "e5"))[0].uci() == "f1b5"
    assert favorite_moves(BotPersonalityConfig()) == {}


def test_openings_endpoint(client):
    found = client.get("/api/v1/bots/openings", params={"q": "ruy lopez"}).json()["openings"]
    assert found[0] == {"eco": "C60", "name": "Ruy Lopez", "epd": RUY, "moves": ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]}
    picked = client.get("/api/v1/bots/openings", params=[("epd", SICILIAN), ("epd", "x"), ("epd", RUY)]).json()
    assert [o["name"] for o in picked["openings"]] == ["Sicilian Defense", "Ruy Lopez"]
    bad = client.post("/api/v1/bots/custom-move", json={"fen": chess.STARTING_FEN, "config": {"openings_white": ["x"]}})
    assert bad.status_code == 422
