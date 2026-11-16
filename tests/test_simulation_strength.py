# --- FILE: tests/test_simulation_strength.py ---
"""
Сила участников в симуляции турнирных партий (таск 28.2): чем ниже рейтинг, тем чаще выбирается не лучший ход.
Раньше при коротком времени на ход рейтинг в партиях ботов ничего не значил (2400 против 1600 — 3,5 из 8).
"""

import random

import chess
import pytest

from src.models.tournament import TournamentPlayer
from src.services import tournament_simulation as sim
from src.services.bots.guests import GUESTS_BY_ID
from src.services.tournament_simulation import SimulatedPlayer, move_weights, temperature_cp


def share(weights: dict, move) -> float:
    return weights[move] / sum(weights.values())


def test_temperature_falls_with_rating():
    ratings = [300, 800, 1000, 1200, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3200]
    temperatures = [temperature_cp(r) for r in ratings]
    assert temperatures == sorted(temperatures, reverse=True)
    assert temperature_cp(300) == temperature_cp(800) and temperature_cp(2800) == temperature_cp(3200)
    # Между опорными точками — линейно.
    assert temperature_cp(1800) == pytest.approx((temperature_cp(1600) + temperature_cp(2000)) / 2)
    assert temperature_cp(2400) < temperature_cp(1600) / 3


def test_strong_player_picks_the_best_move_more_often():
    best, good, pawn_down, piece_down = (chess.Move.from_uci(u) for u in ("e2e4", "d2d4", "a2a3", "h2h4"))
    scores = {best: 30.0, good: 10.0, pawn_down: -70.0, piece_down: -270.0}
    master, club, novice = (move_weights(scores, {}, temperature_cp(r)) for r in (2400, 1600, 800))
    assert share(master, best) > share(club, best) > share(novice, best)
    # Мастер почти не отдаёт пешку и не зевает фигуру; у клубного игрока это редкость, у новичка — обычное дело.
    assert share(master, pawn_down) < 0.01 and share(master, piece_down) < 1e-6
    assert 0.05 < share(club, pawn_down) < 0.25 and share(club, piece_down) < 0.02
    assert share(novice, piece_down) > 0.05
    for weights in (master, club, novice):
        assert weights[best] == 1.0 and weights[best] > weights[good] > weights[pawn_down] > weights[piece_down] > 0


def test_single_candidate_and_equal_moves():
    only = chess.Move.from_uci("e2e4")
    assert move_weights({only: -500.0}, {}, 50.0) == {only: 1.0}
    a, b = chess.Move.from_uci("e2e4"), chess.Move.from_uci("d2d4")
    assert move_weights({a: 20.0, b: 20.0}, {}, 50.0) == {a: 1.0, b: 1.0}


def test_style_tilts_the_choice_but_cannot_rescue_a_bad_move():
    quiet, sharp, losing = (chess.Move.from_uci(u) for u in ("d2d3", "f2f4", "g2g4"))
    scores = {quiet: 20.0, sharp: 0.0, losing: -300.0}
    plain = move_weights(scores, {}, 60.0)
    attacker = move_weights(scores, {sharp: 500.0, losing: 500.0}, 60.0)
    # Любимый ход при небольшой потере становится равным лучшему…
    assert plain[sharp] < 1.0 and attacker[sharp] == 1.0
    # …но бонус стиля ограничен половиной температуры: проигрывающий ход остаётся почти невозможным.
    assert attacker[losing] < 0.001
    # Штраф стиля делает хороший ход менее вероятным, но не запрещает его.
    wary = move_weights(scores, {quiet: -500.0}, 60.0)
    assert 0 < wary[quiet] < plain[quiet]


class ScriptedBot:
    """Бот с заданными оценками ходов: книги нет, движка нет."""

    stockfish_path = None
    search_depth = 6
    time_limit = 0.1

    def __init__(self, book=None, style=None):
        self.book, self.style = book, style or {}

    def _book_move(self, board):
        return self.book

    def evaluate_style_bonus(self, board, move):
        return self.style.get(move.uci(), 0.0), None


def test_simulated_player_uses_the_book_first(monkeypatch):
    monkeypatch.setattr(sim, "analyse_with_stockfish", lambda **kwargs: pytest.fail("книжный ход движка не требует"))
    player = SimulatedPlayer(ScriptedBot(book=(chess.Move.from_uci("c2c4"), {"key": "book.x"})), 2000)
    assert player.choose_move(chess.STARTING_FEN) == {"uci": "c2c4", "source": "opening_book"}


def test_simulated_player_chooses_by_rating(monkeypatch):
    calls = []

    def scores(**kwargs):
        calls.append(kwargs)
        return {chess.Move.from_uci("e2e4"): 40.0, chess.Move.from_uci("a2a3"): -80.0, chess.Move.from_uci("h2h4"): -160.0}

    monkeypatch.setattr(sim, "analyse_with_stockfish", scores)

    def best_share(rating: int) -> float:
        player = SimulatedPlayer(ScriptedBot(), rating, rng=random.Random(7))
        picks = [player.choose_move(chess.STARTING_FEN)["uci"] for _ in range(400)]
        assert set(picks) <= {"e2e4", "a2a3", "h2h4"}
        return picks.count("e2e4") / len(picks)

    master, club, novice = best_share(2400), best_share(1600), best_share(800)
    assert master > 0.99 and 0.6 < club < 0.9 and novice < 0.55 and master > club > novice
    # Оцениваются лучшие ходы на полной силе, с пониженными глубиной и временем.
    assert calls[0]["multipv"] == sim.SIM_CANDIDATES and calls[0]["depth"] == 6 and calls[0]["time_limit"] == 0.1


def test_without_engine_the_static_analyser_is_used(monkeypatch):
    monkeypatch.setattr(sim, "analyse_with_stockfish", lambda **kwargs: {})
    player = SimulatedPlayer(ScriptedBot(), 2400, rng=random.Random(1))
    board = chess.Board()
    assert chess.Move.from_uci(player.choose_move(board.fen())["uci"]) in board.legal_moves


def test_tournament_participants_play_with_their_seeding_rating():
    keres = GUESTS_BY_ID["keres"]
    strong = sim.player_for(TournamentPlayer(seat=1, kind="personality", bot_key=keres.key, rating=keres.rating,
                                             personality_name=keres.pgn_name, config_json=keres.config.model_dump_json()))
    weak = sim.player_for(TournamentPlayer(seat=2, kind="archetype", bot_key="archetype:rusher", rating=700))
    assert (strong.rating, weak.rating) == (2400, 700) and strong.temperature < weak.temperature
    assert strong.bot.search_depth <= sim.SIM_MAX_DEPTH and strong.bot.time_limit <= sim.SIM_TIME_LIMIT_S
    with pytest.raises(ValueError):
        sim.player_for(TournamentPlayer(seat=3, kind="user", rating=1200))


def test_historic_tournaments_simulate_masters_at_their_declared_strength():
    from src.api.bots import BOT_METADATA
    from src.services.bots.calibration import strength_of

    declared = int(str(BOT_METADATA["chigorin"]["rating"]))
    measured = strength_of("chigorin", declared).rating
    chigorin = TournamentPlayer(seat=1, kind="bot", bot_key="chigorin", rating=measured)
    # В обычном турнире — сила на старте (измеренная), в «Машине времени» — заявленная, историческая.
    assert sim.simulation_rating(chigorin) == measured
    assert sim.simulation_rating(chigorin, historic=True) == declared == 2150
    assert sim.player_for(chigorin, historic=True).rating == declared
    # У мастеров прошлого и архетипов заявленная сила и есть сила на старте.
    keres = GUESTS_BY_ID["keres"]
    guest = TournamentPlayer(seat=2, kind="personality", bot_key=keres.key, rating=keres.rating,
                             personality_name=keres.pgn_name, config_json=keres.config.model_dump_json())
    assert sim.simulation_rating(guest, historic=True) == sim.simulation_rating(guest) == 2400


def test_weak_player_loses_a_match_to_a_strong_one_on_the_static_analyser(monkeypatch):
    # Без движка (как в CI): статический анализатор видит на два полухода — и этого хватает, чтобы сила решала.
    monkeypatch.setattr(sim, "analyse_with_stockfish", lambda **kwargs: {})

    def judge(board: chess.Board) -> str:
        from src.services.bots.base import static_board_eval_cp

        cp = static_board_eval_cp(board, chess.WHITE)
        return "1-0" if cp > 300 else "0-1" if cp < -300 else "1/2-1/2"

    score = 0.0
    for game in range(4):
        rng = random.Random(100 + game)
        strong = SimulatedPlayer(ScriptedBot(), 2400, rng=rng)
        weak = SimulatedPlayer(ScriptedBot(), 800, rng=rng)
        strong_white = game % 2 == 0
        _, result, _ = sim.play_game(strong if strong_white else weak, weak if strong_white else strong,
                                     max_plies=100, judge=judge)
        points = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}[result]
        score += points if strong_white else 1 - points
    assert score >= 3
