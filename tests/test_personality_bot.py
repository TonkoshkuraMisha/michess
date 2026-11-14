# --- FILE: tests/test_personality_bot.py ---
"""
Параметрическая модель соперника (src/services/bots/personality.py): ползунки переставляют
кандидатов движка внутри окна blunder_guard_cp, сила задаётся target_elo, ниже 1320 — управляемые
ошибки. Вывод движка подменён: кандидаты и их оценки задаёт тест.
"""

import chess
import pytest
from pydantic import ValidationError

from src.core.config import settings
from src.services.bots import base as bots_base
from src.services.bots import personality
from src.services.bots.personality import (
    BotPersonalityConfig,
    PersonalityBot,
    build_style,
    strength_for,
)

API = "/api/v1"
# Признаки, кроме агрессии, выключены — выбор определяет только проверяемый ползунок.
ONLY_AGGRESSION = {"center_control": 0, "mobility": 0, "king_safety": 0, "pawn_structure": 0, "randomness": 0}

# Чёрная пешка d6 бьёт коня e5 (угроза dxe5). Кандидаты:
#   Nf3 — тихий ход, снимающий угрозу (профилактика);
#   Rh8+ — шах;
#   Kd2 — нейтральный тихий ход, угроза остаётся;
#   Nd7 — конь встаёт под бой короля без защиты (жертва) рядом с королём.
THREAT_FEN = "4k3/8/3p4/4N3/8/8/8/4K2R w K - 0 1"


def _move(board: chess.Board, san: str) -> chess.Move:
    return board.parse_san(san)


@pytest.fixture
def engine_lines(monkeypatch):
    """Подменяет MultiPV движка: {san: оценка в сп} для позиции из теста."""

    def install(fen: str, lines: dict[str, float]):
        board = chess.Board(fen)
        scores = {_move(board, san): cp for san, cp in lines.items()}
        monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: dict(scores))
        return board

    return install


def _choose(config: BotPersonalityConfig, fen: str) -> str:
    board = chess.Board(fen)
    result = PersonalityBot(config).choose_move(fen)
    return board.san(chess.Move.from_uci(result["uci"]))


# --- Схема ---------------------------------------------------------------------------------------

def test_default_config_is_balanced():
    config = BotPersonalityConfig()
    assert config.aggression == 0
    assert config.center_control == config.mobility == config.king_safety == config.pawn_structure == 100
    assert config.piece_values.is_standard()
    assert 600 <= config.target_elo <= 2800


@pytest.mark.parametrize("field, value", [
    ("aggression", 101), ("aggression", -101),
    ("center_control", -1), ("mobility", 201), ("king_safety", 201), ("pawn_structure", -1),
    ("randomness", 101), ("blunder_guard_cp", 401), ("blunder_guard_cp", -1),
    ("target_elo", 599), ("target_elo", 2801),
])
def test_config_bounds(field, value):
    with pytest.raises(ValidationError):
        BotPersonalityConfig(**{field: value})


@pytest.mark.parametrize("piece_name, value", [
    ("pawn", 0.4), ("pawn", 1.6), ("knight", 1.9), ("bishop", 4.6), ("rook", 3.4), ("rook", 6.6),
    ("queen", 6.9), ("queen", 11.1),
])
def test_piece_value_bounds(piece_name, value):
    with pytest.raises(ValidationError):
        BotPersonalityConfig(piece_values={piece_name: value})


def test_unknown_fields_are_rejected():
    # Глубину и время поиска клиент не задаёт — их выбирает сервер.
    with pytest.raises(ValidationError):
        BotPersonalityConfig(depth=30)


# --- Сила ----------------------------------------------------------------------------------------

def test_strength_limits_search_and_starts_errors_below_stockfish_minimum():
    weakest, strongest = strength_for(600), strength_for(2800)
    assert weakest.uci_elo == 1320 and weakest.error_rate == pytest.approx(0.40)
    assert strength_for(1320).error_rate == pytest.approx(0.07) and strength_for(1320).uci_elo == 1320
    # Кривая по калибровке: между точками линейно, к 1450 ошибки сходят на нет.
    assert strength_for(1000).error_rate == pytest.approx(0.22)
    assert strength_for(1450).error_rate == 0 and strength_for(1500).error_rate == 0
    assert strongest.uci_elo == 2800 and strongest.error_rate == 0
    assert strongest.depth == 8 and strongest.time_limit <= 0.5
    assert weakest.depth < strongest.depth


def test_strength_grows_monotonically():
    levels = [strength_for(elo) for elo in range(600, 2801, 100)]
    for weaker, stronger in zip(levels, levels[1:], strict=False):
        assert stronger.depth >= weaker.depth
        assert stronger.skill_level >= weaker.skill_level
        assert stronger.error_rate <= weaker.error_rate
        assert stronger.uci_elo >= weaker.uci_elo


def test_bot_uses_server_side_strength():
    bot = PersonalityBot(BotPersonalityConfig(target_elo=2000))
    expected = strength_for(2000)
    assert (bot.uci_elo, bot.search_depth, bot.time_limit) == (expected.uci_elo, expected.depth, expected.time_limit)
    assert bot.multipv == 8


# --- Выбор хода на подменённом движке ----------------------------------------------------------

def test_aggressive_personality_prefers_check_among_equal_lines(engine_lines):
    engine_lines(THREAT_FEN, {"Nf3": 0, "Rh8+": 0, "Kd2": 0})
    assert _choose(BotPersonalityConfig(aggression=100, **ONLY_AGGRESSION), THREAT_FEN) == "Rh8+"


def test_aggressive_personality_prefers_sacrifice_over_quiet_move(engine_lines):
    engine_lines(THREAT_FEN, {"Nd7": 0, "Kd2": 0})
    assert _choose(BotPersonalityConfig(aggression=100, **ONLY_AGGRESSION), THREAT_FEN) == "Nd7"


def test_calm_personality_prefers_prophylaxis(engine_lines):
    engine_lines(THREAT_FEN, {"Nf3": 0, "Rh8+": 0, "Kd2": 0})
    assert _choose(BotPersonalityConfig(aggression=-100, **ONLY_AGGRESSION), THREAT_FEN) == "Nf3"


def test_zero_blunder_guard_always_plays_the_top_line(engine_lines):
    engine_lines(THREAT_FEN, {"Nf3": 30, "Rh8+": 0, "Kd2": 0})
    config = BotPersonalityConfig(aggression=100, blunder_guard_cp=0, randomness=100)
    assert {_choose(config, THREAT_FEN) for _ in range(20)} == {"Nf3"}


def test_wide_window_lets_style_override_a_slightly_better_line(engine_lines):
    engine_lines(THREAT_FEN, {"Nf3": 30, "Rh8+": 0, "Kd2": 0})
    config = BotPersonalityConfig(aggression=100, blunder_guard_cp=120, **ONLY_AGGRESSION)
    assert _choose(config, THREAT_FEN) == "Rh8+"


def test_weak_target_elo_makes_controlled_errors(engine_lines, monkeypatch):
    engine_lines(THREAT_FEN, {"Nf3": 300, "Rh8+": 0, "Kd2": -50})
    monkeypatch.setattr(personality.random, "random", lambda: 0.0)  # ошибка выпадает всегда
    weak = BotPersonalityConfig(target_elo=600, blunder_guard_cp=0, **ONLY_AGGRESSION)
    assert _choose(weak, THREAT_FEN) != "Nf3"  # ошибка — не лучшая линия (с random()=0 — случайный зевок)

    # С 1320 и выше ошибок нет: с нулевым окном играется лучшая линия.
    strong = BotPersonalityConfig(target_elo=1500, blunder_guard_cp=0, **ONLY_AGGRESSION)
    assert _choose(strong, THREAT_FEN) == "Nf3"


def test_piece_values_shift_exchange_preference():
    # Белые могут взять коня (Rxe5) или слона (Rxb5) — для стандартной шкалы это равноценно.
    fen = "4k3/8/8/1b2n3/8/8/8/1R2R1K1 w - - 0 1"
    board = chess.Board(fen)
    knights_lover = build_style(BotPersonalityConfig(
        aggression=0, piece_values={"knight": 4.0}, **ONLY_AGGRESSION,
    ))
    take_knight = knights_lover.evaluate(board, _move(board, "Rxe5"))[0]
    take_bishop = knights_lover.evaluate(board, _move(board, "Rxb5"))[0]
    assert take_knight > take_bishop


def test_comment_explains_the_chosen_move(engine_lines):
    engine_lines(THREAT_FEN, {"Rh8+": 0})
    result = PersonalityBot(BotPersonalityConfig(aggression=100, **ONLY_AGGRESSION)).choose_move(THREAT_FEN)
    assert result["comment"] == {"key": "personality.check", "params": {}}
    assert result["source"] == "personality_engine"


def test_without_engine_static_analyzer_still_finds_mate(monkeypatch):
    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})
    fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"  # Ra8#
    result = PersonalityBot(BotPersonalityConfig(randomness=0)).choose_move(fen)
    assert result["san"] == "Ra8#"
    assert result["engine_backend"] == "fallback_minimax"


# --- API -----------------------------------------------------------------------------------------

def test_custom_move_endpoint_returns_a_legal_move(client, monkeypatch):
    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})
    response = client.post(f"{API}/bots/custom-move", json={
        "fen": chess.STARTING_FEN,
        "config": {"aggression": 60, "target_elo": 1200, "piece_values": {"bishop": 3.5}},
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["bot_id"] == "custom"
    assert chess.Move.from_uci(data["uci"]) in chess.Board().legal_moves
    assert data["comment"]
    assert data["thinking_time_ms"] > 0


def test_custom_move_endpoint_validates_config_and_position(client):
    too_aggressive = client.post(f"{API}/bots/custom-move", json={
        "fen": chess.STARTING_FEN, "config": {"aggression": 500},
    })
    assert too_aggressive.status_code == 422
    impossible = client.post(f"{API}/bots/custom-move", json={"fen": "kK6/8/8/8/8/8/8/8 w - - 0 1"})
    assert impossible.status_code == 400


def test_custom_move_shares_the_bot_move_rate_limit(client, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(bots_base, "analyse_with_stockfish", lambda **kwargs: {})
    monkeypatch.setattr(settings, "RATE_LIMIT_BOT_MOVE", 2)
    fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"

    first = client.post(f"{API}/bots/move", json={"bot_id": "philidor", "fen": fen})
    second = client.post(f"{API}/bots/custom-move", json={"fen": fen})
    third = client.post(f"{API}/bots/custom-move", json={"fen": fen})

    assert [first.status_code, second.status_code, third.status_code] == [200, 200, 429]


def test_weak_error_without_blunder_takes_the_worse_half_of_the_lines(engine_lines, monkeypatch):
    engine_lines(THREAT_FEN, {"Nf3": 300, "Nc6": 250, "Rh8+": 0, "Kd2": -50})
    rolls = iter([0.0, 0.9])  # ошибка выпала; не зевок — ход из худшей половины линий
    monkeypatch.setattr(personality.random, "random", lambda: next(rolls))
    weak = BotPersonalityConfig(target_elo=600, blunder_guard_cp=0, **ONLY_AGGRESSION)
    assert _choose(weak, THREAT_FEN) in {"Rh8+", "Kd2"}
