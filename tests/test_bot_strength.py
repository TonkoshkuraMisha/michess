# --- FILE: tests/test_bot_strength.py ---
"""
Сила ботов (таск 10.5): ограничение UCI_Elo в Stockfish действует только на его собственный выбор хода, поэтому
сила бота задаётся опорным ходом — ходом движка с ограничением силы, — а стиль выбирает среди равных ему ходов.
"""

import chess
import pytest

from src.api.bots import AVAILABLE_BOTS
from src.services.bots import BOT_INSTANCES
from src.services.bots import base as bots_base
from src.services.bots.personality import BotPersonalityConfig, PersonalityBot

# Позиция из миттельшпиля — вне дебютных книг ботов.
FEN = "r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10"
BOARD = chess.Board(FEN)
BEST, REF, NEAR, BLUNDER = (BOARD.parse_san(s) for s in ("Rc1", "g3", "a3", "Bxh7+"))


@pytest.fixture
def engine(monkeypatch):
    """Подменённый движок: MultiPV-оценки, опорный ход и оценка отдельного хода; записывает вызовы."""
    calls: dict[str, list] = {"reference": [], "score": []}

    def install(scores: dict[chess.Move, float], reference: chess.Move | None, reference_score: float = 0.0):
        monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: dict(scores))

        def ref(board, path, uci_elo, time_limit):
            calls["reference"].append(uci_elo)
            return reference

        def score(board, path, move, depth, time_limit):
            calls["score"].append(move)
            return reference_score

        monkeypatch.setattr(bots_base, "strength_reference_move", ref)
        monkeypatch.setattr(bots_base, "score_move", score)
        monkeypatch.setattr(bots_base.os.path, "exists", lambda path: True)
        return calls

    return install


def test_declared_rating_is_the_engine_strength_target():
    declared = {b["id"]: b["rating"] for b in AVAILABLE_BOTS}
    assert {bot_id: bot.uci_elo for bot_id, bot in BOT_INSTANCES.items()} == declared


def test_bot_plays_moves_as_strong_as_the_reference_not_the_best(engine):
    engine({BEST: 300, REF: 0, NEAR: -20, BLUNDER: -400}, reference=REF)
    bot = BOT_INSTANCES["philidor"].__class__(stockfish_path="stockfish")
    played = {bot.choose_move(FEN)["uci"] for _ in range(30)}
    assert played <= {REF.uci(), NEAR.uci()}  # ни лучший ход (сильнее заявленного), ни зевок


def test_reference_outside_multipv_is_scored_separately(engine):
    calls = engine({BEST: 50, NEAR: 40}, reference=BLUNDER, reference_score=-200)
    bot = BOT_INSTANCES["morphy"].__class__(stockfish_path="stockfish")
    assert bot.choose_move(FEN)["uci"] == BLUNDER.uci()  # опорный ход слабый — и бот играет на этом уровне
    assert calls["score"] == [BLUNDER]
    assert calls["reference"] == [bot.uci_elo]


def test_without_reference_the_window_counts_from_the_best_move(engine):
    engine({BEST: 300, REF: 0}, reference=None)
    bot = BOT_INSTANCES["philidor"].__class__(stockfish_path="stockfish")
    assert {bot.choose_move(FEN)["uci"] for _ in range(10)} == {BEST.uci()}


def test_personality_requests_its_target_strength(engine):
    calls = engine({BEST: 10, REF: 0}, reference=REF)
    PersonalityBot(BotPersonalityConfig(target_elo=1700), stockfish_path="stockfish").choose_move(FEN)
    assert calls["reference"] == [1700]
    calls["reference"].clear()
    PersonalityBot(BotPersonalityConfig(target_elo=900), stockfish_path="stockfish").choose_move(FEN)
    assert calls["reference"] == [1320]  # слабее Stockfish не играет — дальше намеренные ошибки


def test_reference_needs_engine_and_strength_limit(monkeypatch):
    monkeypatch.undo()  # настоящая функция вместо заглушки из conftest
    assert bots_base.strength_reference_move(BOARD, None, 1500, 0.1) is None  # нет движка
    assert bots_base.strength_reference_move(BOARD, "/no/such/stockfish", 1500, 0.1) is None
    assert bots_base.strength_reference_move(BOARD, "stockfish", None, 0.1) is None  # без ограничения силы


def test_analysis_runs_at_full_strength(monkeypatch):
    seen = []

    class Pool:
        def acquire(self, options):
            seen.append(options)
            raise RuntimeError("no engine in tests")

    monkeypatch.setattr(bots_base, "get_engine_pool", lambda path: Pool())
    monkeypatch.setattr(bots_base.os.path, "exists", lambda path: True)
    assert bots_base.analyse_with_stockfish(board=BOARD, engine_path="stockfish", uci_elo=1400) == {}
    assert seen == [{}]  # без UCI_LimitStrength: оно не влияет на analyse, а оценки нужны честные
