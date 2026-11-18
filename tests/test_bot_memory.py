# --- FILE: tests/test_bot_memory.py ---
"""
Память ботов (таск 32.1): опыт дебютных вариантов, рейтинг по партиям с людьми, поправка силы; память о
сопернике (32.2) — по итогам и по ошибкам из разбора партии.
"""

import json
import random
from collections import Counter

import chess
import pytest
from sqlalchemy import select

from src.models.bot_memory import BotOpeningStat, BotRating
from src.models.tournament import TournamentPlayer
from src.services import tournament_simulation
from src.services.bots import BOT_INSTANCES, memory
from src.services.bots.base import HistoricalBot, normalize_fen_key

START_KEY = normalize_fen_key(chess.Board())


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def clean_memory():
    memory.forget()
    yield
    memory.forget()


def _after(*moves: str) -> str:
    board = chess.Board()
    for uci in moves:
        board.push_uci(uci)
    return normalize_fen_key(board)


def _morphy_line() -> list[str]:
    """1.e4 и первый ответ Морфи из его книги, затем ход вне книги."""
    book = BOT_INSTANCES["morphy"].opening_book
    reply = str(book[_after("e2e4")][0][0])
    return ["e2e4", reply, "a2a3"]


def test_book_factor_rewards_and_punishes_within_bounds():
    assert memory.book_factor("x", START_KEY, "e2e4") == 1.0                     # опыта нет
    memory._book["x"] = {(START_KEY, "e2e4"): (40, 40.0), (START_KEY, "d2d4"): (40, 0.0), (START_KEY, "c2c4"): (2, 1.0)}
    win, loss, even = (memory.book_factor("x", START_KEY, u) for u in ("e2e4", "d2d4", "c2c4"))
    assert memory.FACTOR_MIN < loss < 1.0 == even < win < memory.FACTOR_MAX


def test_book_moves_played_stop_when_leaving_the_book():
    book = {START_KEY: [("e2e4", 5, 1)], _after("e2e4", "e7e5"): [("g1f3", 5, 1)]}
    assert memory.book_moves_played(book, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], chess.WHITE) == [
        (START_KEY, "e2e4"), (_after("e2e4", "e7e5"), "g1f3")]
    # Бот сыграл не по книге — дальше не считаем, даже если позже книга снова совпала бы.
    assert memory.book_moves_played(book, ["d2d4", "e7e5"], chess.WHITE) == []


def test_experience_shifts_the_book_choice():
    class Probe(HistoricalBot):
        bot_id = "probe"
        opening_book = {START_KEY: [("e2e4", 10, "x"), ("d2d4", 10, "y")]}

    bot = Probe(stockfish_path="")
    random.seed(7)
    memory._book["probe"] = {(START_KEY, "e2e4"): (60, 0.0), (START_KEY, "d2d4"): (60, 60.0)}
    picks = Counter(bot._book_move(chess.Board())[0].uci() for _ in range(600))
    assert picks["d2d4"] > 2 * picks["e2e4"] > 0                                # проигранная линия — реже, но не никогда


async def test_saved_game_teaches_the_bot(client, token_user_1, db_session):
    line = _morphy_line()
    saved = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": line, "termination": "resignation",
    })
    assert saved.status_code == 200, saved.text
    first = memory.bot_points(saved.json()["result"], chess.BLACK)            # итог по сдаче выводит сервер
    [stat] = (await db_session.execute(select(BotOpeningStat).where(BotOpeningStat.bot_id == "morphy"))).scalars().all()
    assert (stat.fen_key, stat.uci, stat.games, stat.points) == (_after("e2e4"), line[1], 1, first)
    rating = await db_session.get(BotRating, "morphy")
    assert rating.games == 1 and rating.offset == 0

    # Вслепую — опыт дебюта есть, рейтинг не меняется.
    second = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": line, "termination": "resignation",
        "blindfold": 2, "peeks": 0,
    }).json()["result"]
    await db_session.refresh(stat)
    await db_session.refresh(rating)
    assert (stat.games, stat.points, rating.games) == (2, first + memory.bot_points(second, chess.BLACK), 1)

    catalog = client.get("/api/v1/bots/catalog").json()
    morphy = next(b for b in catalog["historical"] if b["id"] == "morphy")
    assert morphy["live"]["games"] == 1
    assert next(b for b in catalog["historical"] if b["id"] == "philidor")["live"] is None


async def test_strength_offset_pulls_back_to_declared(db_session, monkeypatch):
    monkeypatch.setattr(memory, "OFFSET_MIN_GAMES", 4)
    monkeypatch.setattr(memory, "OFFSET_EVERY", 2)
    # Бот заявлен 1500, а люди 1500 у него всё время выигрывают — значит, играет слабее: поправка вверх.
    for _ in range(24):
        row = await memory.record_rating(db_session, "probe", 1500, 1500, 0.0)
    assert row.games == 24 and row.rating < 1400
    assert 0 < row.offset <= memory.MAX_OFFSET
    assert memory.strength_offset("probe") == row.offset
    assert memory.next_offset(0, 1480, 1500) == 0                                # расхождение мало — без поправки
    assert memory.next_offset(140, 1000, 1500) == memory.MAX_OFFSET              # не дальше предела


async def test_tournament_games_teach_openings(db_session):
    line = _morphy_line()
    morphy = TournamentPlayer(tournament_id=1, seat=1, kind="bot", bot_key="morphy", rating=2000)
    human = TournamentPlayer(tournament_id=1, seat=2, kind="human", rating=1500)
    await tournament_simulation._remember_openings(db_session, human, morphy, line, "1/2-1/2")
    [stat] = (await db_session.execute(select(BotOpeningStat))).scalars().all()
    assert (stat.bot_id, stat.uci, stat.points) == ("morphy", line[1], 0.5)
    assert await db_session.get(BotRating, "morphy") is None                    # турнир ботов на рейтинг не влияет


# --- память о сопернике (таск 32.2) ---------------------------------------------------------------

def test_rival_factor_prefers_lines_where_the_player_struggles():
    rival = memory.Rival("probe", 3, {
        (START_KEY, "e2e4"): (2, 2.0, False),     # игрок дважды проиграл — бот идёт туда охотнее
        (START_KEY, "d2d4"): (1, 0.0, True),      # с этим ходом бот проиграл ему в последний раз
    })
    good, lost, unknown = (memory.rival_factor(rival, START_KEY, u) for u in ("e2e4", "d2d4", "c2c4"))
    assert lost < 0.1 < unknown == 1.0 < good <= memory.RIVAL_MAX


def test_rival_only_for_its_bot_and_regular_opponent():
    memory.use_rival(memory.Rival("probe", 1, {(START_KEY, "d2d4"): (1, 0.0, True)}))
    assert memory.book_factor("probe", START_KEY, "d2d4") == 1.0           # одна партия — ещё не постоянный соперник
    memory.use_rival(memory.Rival("probe", 2, {(START_KEY, "d2d4"): (1, 0.0, True)}))
    assert memory.book_factor("other", START_KEY, "d2d4") == 1.0           # чужой бот этого игрока не помнит
    assert memory.book_factor("probe", START_KEY, "d2d4") < 0.1
    memory.use_rival(None)


async def test_bot_remembers_its_rival_through_the_api(client, token_user_1, test_user_1, db_session):
    line = _morphy_line()
    for _ in range(2):
        response = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
            "bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": line,
            "termination": "resignation",
        })
        assert response.status_code == 200, response.text
    # С помощью наставника партия о сопернике ничего не говорит.
    client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
        "bot_id": "morphy", "player_color": "white", "result": "1-0", "moves_uci": line, "termination": "resignation",
        "assisted": True,
    })
    rivalry = client.get("/api/v1/bots/rivalry", headers=auth(token_user_1)).json()["rivals"]
    assert [(r["bot_id"], r["games"], r["remembers"]) for r in rivalry] == [("morphy", 2, True)]
    rival = await memory.load_rival(db_session, "morphy", test_user_1.id)
    assert rival is not None and rival.games == 2
    assert rival.moves[(_after("e2e4"), line[1])][0] == 2
    assert await memory.load_rival(db_session, "morphy", None) is None
    assert client.get("/api/v1/bots/rivalry").status_code == 401


async def test_move_request_passes_the_rival_into_the_move_thread(client, token_user_1, test_user_1, db_session,
                                                                   monkeypatch):
    from src.models.bot_memory import BotRival

    db_session.add(BotRival(bot_id="morphy", user_id=test_user_1.id, games=3, points=0.0))
    await db_session.commit()
    seen = []

    def fake_choose(fen):
        seen.append(memory._rival.get())
        return {"uci": "e7e5", "san": "e5", "fen_after": fen, "source": "opening_book",
                "comment": {"key": "common.positional", "params": {}}}

    monkeypatch.setattr(BOT_INSTANCES["morphy"], "choose_move", fake_choose)
    fen = chess.Board().fen().replace(" w ", " b ")
    client.post("/api/v1/bots/move", headers=auth(token_user_1), json={"bot_id": "morphy", "fen": fen})
    client.post("/api/v1/bots/move", json={"bot_id": "morphy", "fen": fen})          # гость — соперника нет
    assert [r.games if r else None for r in seen] == [3, None]


# --- где соперник ошибается: по разбору партии (32.2) ----------------------------------------------

def _report(moves: list[str], errors: dict[int, str]) -> list[dict]:
    """Ходы разбора (analysis_json): у хода с номером из errors — этот класс, у остальных — Best."""
    return [{"ply": i + 1, "uci": uci, "color": "white" if i % 2 == 0 else "black",
             "classification": errors.get(i + 1, "Best")} for i, uci in enumerate(moves)]


def test_erred_after_counts_only_player_errors_inside_the_window():
    book = [(2, "k2", "m2"), (4, "k4", "m4")]
    moves = [f"m{i}" for i in range(1, 30)]
    window = memory.ERROR_WINDOW
    # Ошибка белых на 5-м полуходе — после обоих ходов бота; неточность и ошибка самого бота не считаются.
    assert memory.erred_after(book, _report(moves, {5: "Mistake", 3: "Inaccuracy", 6: "Blunder"}), "white") == {
        ("k2", "m2"), ("k4", "m4")}
    # Ошибка дальше окна от первого хода бота — только второму.
    assert memory.erred_after(book, _report(moves, {3 + window: "Blunder"}), "white") == {("k4", "m4")}
    assert memory.erred_after(book, _report(moves, {}), "white") == set()


def test_rival_factor_leans_towards_lines_where_the_player_erred():
    calm = memory.Rival("probe", 3, {(START_KEY, "e2e4"): (2, 1.0, False)})
    erring = memory.Rival("probe", 3, {(START_KEY, "e2e4"): (2, 1.0, False)}, {(START_KEY, "e2e4"): 2})
    base, more = memory.rival_factor(calm, START_KEY, "e2e4"), memory.rival_factor(erring, START_KEY, "e2e4")
    assert base < more < base * memory.ERROR_MAX


async def test_analysed_game_teaches_the_bot_where_its_rival_errs(client, token_user_1, test_user_1, db_session):
    from src.models.game import Game

    line = _morphy_line()
    game_ids = []
    for _ in range(2):
        response = client.post("/api/v1/bots/save-game", headers=auth(token_user_1), json={
            "bot_id": "morphy", "player_color": "white", "result": "0-1", "moves_uci": line,
            "termination": "resignation",
        })
        assert response.status_code == 200, response.text
        game_ids.append(response.json()["game_id"])
    # Разбор первой партии: после ответа Морфи из книги игрок зевнул (3-й полуход).
    game = await db_session.get(Game, game_ids[0])
    game.analysis_json = json.dumps({"moves": _report(line, {3: "Blunder"})})
    await db_session.commit()
    assert await memory.record_rival_errors(db_session, game_ids[0]) == 1
    assert await memory.record_rival_errors(db_session, game_ids[0]) == 0          # повторный разбор не удваивает
    rival = await memory.load_rival(db_session, "morphy", test_user_1.id)
    assert rival is not None and rival.errors == {(_after("e2e4"), line[1]): 1}
    # Без разбора и для неизвестной партии — ничего.
    assert await memory.record_rival_errors(db_session, game_ids[1]) == 0
    assert await memory.record_rival_errors(db_session, 10 ** 9) == 0
