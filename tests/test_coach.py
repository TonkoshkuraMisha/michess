# --- FILE: tests/test_coach.py ---
"""
Наставник словами (таск 11.2): комментарии к ходам и совет по позиции.

* Каталоги клиента на трёх языках содержат ровно те шаблоны, которые может отдать сервер, и не используют
  параметров, которых сервер не присылает.
* Объяснения правдивы: причина ошибки называется, только если её подтверждает ответ движка; размен не
  выдаётся за потерю материала; идеей хода считается только то, что создал сам ход.
* Разбор партии хранит версию формата, старый кэш не отдаётся и пересчитывается; без движка комментариев нет.
* POST /analysis/advice — под правилом честной игры, со своим лимитом и кодами ошибок.
"""

import json
import pathlib
import re
import string

import chess
import pytest

from src.core.config import settings
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services import analysis_service as analysis_module
from src.services.analysis_service import ANALYSIS_FORMAT_VERSION, attach_coach_comments, is_current_analysis
from src.services.coach import (
    TEMPLATES,
    VARIANTS,
    advice_for_position,
    all_message_keys,
    comment_for_move,
    figurine_san,
)
from src.services.game_state import state_manager

ROOT = pathlib.Path(__file__).resolve().parent.parent
ADVICE_URL = "/api/v1/analysis/advice"


def _keys(comment: dict | None) -> list[str]:
    return [s["key"].rsplit(".", 1)[0] for s in (comment or {}).get("comment", [])]


def _move(uci: str) -> chess.Move:
    return chess.Move.from_uci(uci)


# --- каталоги ----------------------------------------------------------------------------------------------------

def _coach_catalog(language: str) -> dict[str, str]:
    text = (ROOT / "frontend" / "src" / "i18n" / "messages" / f"{language}.ts").read_text(encoding="utf-8")
    block = text[text.index("    coach: {"):]
    texts: dict[str, str] = {}
    group = code = None
    for line in block.splitlines()[1:]:
        if m := re.match(r"^        (\w+): \{$", line):
            group = m.group(1)
        elif m := re.match(r"^            (\w+): \{$", line):
            code = m.group(1)
        elif m := re.match(r"^                (v\d+): '((?:[^'\\]|\\.)*)',$", line):
            texts[f"coach.{group}.{code}.{m.group(1)}"] = m.group(2)
        elif line == "    },":
            break
    return texts


@pytest.mark.parametrize("language", ["en", "uk", "ru"])
def test_catalog_has_every_template_variant_and_only_known_params(language):
    catalog = _coach_catalog(language)
    expected = all_message_keys()
    assert set(catalog) == set(expected)
    for key, text in catalog.items():
        used = {name for _, name, _, _ in string.Formatter().parse(text) if name}
        assert used <= set(expected[key]), f"{language}: {key} uses {used - set(expected[key])}"


def test_every_template_has_all_variants():
    assert len(all_message_keys()) == len(TEMPLATES) * VARIANTS


# --- нотация -------------------------------------------------------------------------------------------------------

def test_figurine_san():
    board = chess.Board("r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1")
    assert figurine_san(board, _move("e1g1")) == "O-O"
    assert figurine_san(board, _move("b7a8q")) == "bxa8=♕+"
    assert figurine_san(board, _move("a1a7")) == "♖a7"
    board.turn = chess.BLACK
    assert figurine_san(board, _move("h8h2")) == "♜h2"
    assert figurine_san(board, _move("e8c8")) == "O-O-O"


# --- комментарии к ходам ---------------------------------------------------------------------------------------------

ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
FORK_SETUP = "r2qk2r/ppp2ppp/2n5/4N3/2B5/8/PPP2PPP/R2QK2R w KQkq - 0 10"
SCHOLARS = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"
MATE_IN_ONE = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"


def test_blunder_names_the_lost_piece_confirmed_by_the_reply():
    coach = comment_for_move(chess.Board(ITALIAN), _move("c4f7"), "e1g1", "e8f7", "Blunder")
    # Лучший ход — рокировка: наставник называет её идею, а не просто «сильнее было» (таск B.4).
    assert _keys(coach) == ["coach.verdict.blunder", "coach.threat.hanging", "coach.best.pos_castle"]
    assert coach["comment"][1]["params"] == {"piece": "♗f7"}
    assert {"from": "e1", "to": "g1", "kind": "best"} in coach["arrows"]


def test_unconfirmed_reason_is_not_named():
    """Ответ движка не берёт слона — значит, «висящий слон» не причина, и наставник о нём молчит."""
    coach = comment_for_move(chess.Board(ITALIAN), _move("c4f7"), "e1g1", "d7d6", "Blunder")
    assert "coach.threat.hanging" not in _keys(coach)


def test_allowed_mate_is_explained():
    coach = comment_for_move(chess.Board(SCHOLARS), _move("h7h6"), "g7g6", "h5f7", "Blunder")
    assert _keys(coach)[:2] == ["coach.verdict.blunder", "coach.threat.mate_in"]
    assert coach["comment"][1]["params"] == {"n": 1, "move": "♕xf7#"}


def test_missed_fork_is_the_idea_of_the_best_move():
    coach = comment_for_move(chess.Board(FORK_SETUP), _move("e1g1"), "e5f7", None, "Mistake")
    assert "coach.best.fork" in _keys(coach)
    fork = next(s for s in coach["comment"] if s["key"].startswith("coach.best.fork"))
    assert fork["params"] == {"move": "♘xf7", "attacker": "♘f7", "target1": "♛d8", "target2": "♜h8"}
    assert {"from": "f7", "to": "d8", "kind": "idea"} in coach["arrows"]


def test_good_tactical_move_is_praised_and_quiet_good_move_is_not():
    fork = comment_for_move(chess.Board(FORK_SETUP), _move("e5f7"), "e5f7", None, "Best")
    assert _keys(fork) == ["coach.good.fork"]
    assert comment_for_move(chess.Board(), _move("e2e4"), "e2e4", None, "Best") is None


def test_checkmate_is_praised():
    coach = comment_for_move(chess.Board(MATE_IN_ONE), _move("h5f7"), "h5f7", None, "Best")
    assert _keys(coach) == ["coach.good.checkmate"]


def test_an_exchange_is_not_called_a_loss():
    """Конь взял коня и отыгран — это размен, а не «фигуру можно взять с выигрышем»."""
    knight_trade = chess.Board("rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2")
    knight_trade.push_uci("f3e5")
    knight_trade.push_uci("b8c6")
    coach = comment_for_move(knight_trade, _move("e5c6"), "d2d4", "d7c6", "Inaccuracy")
    assert "coach.threat.hanging" not in _keys(coach)


def test_motif_not_created_by_the_move_is_not_its_idea():
    """Король отошёл, а где-то на доске «сложилась» связка, — это не идея хода."""
    board = chess.Board("4k3/8/8/8/1b6/8/3N4/4K2R w - - 0 1")  # связка Bb4–Nd2–Ke1 уже есть
    coach = comment_for_move(board, _move("h1h2"), "h1h2", None, "Best")
    assert coach is None


def test_variant_choice_is_deterministic():
    board = chess.Board(ITALIAN)
    first = comment_for_move(board, _move("c4f7"), "e1g1", "e8f7", "Blunder")
    second = comment_for_move(board, _move("c4f7"), "e1g1", "e8f7", "Blunder")
    assert first == second
    assert all(re.match(r"^coach\.\w+\.\w+\.v[12]$", s["key"]) for s in first["comment"])


def test_illegal_or_unknown_input_is_not_commented():
    assert comment_for_move(chess.Board(), _move("e2e5"), None, None, "Blunder") is None
    assert comment_for_move(chess.Board(), _move("e2e4"), None, None, "Book") is None


# --- совет по позиции -------------------------------------------------------------------------------------------------

def test_advice_with_mate_says_only_the_mate():
    advice = advice_for_position(chess.Board(MATE_IN_ONE), "h5f7")
    assert _keys(advice) == ["coach.advice.chance_mate"]
    assert advice["arrows"] == [{"from": "h5", "to": "f7", "kind": "best"}]


def test_advice_warns_about_a_mate_threat():
    advice = advice_for_position(chess.Board(SCHOLARS), "g7g6")
    assert _keys(advice)[0] == "coach.threat.mate_threat"
    assert advice["comment"][0]["params"] == {"piece": "♕h5", "square": "f7"}


def test_advice_without_engine_and_without_tactics_is_calm():
    assert _keys(advice_for_position(chess.Board(), None)) == ["coach.advice.quiet"]


def test_advice_without_engine_still_sees_a_free_piece():
    board = chess.Board("4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1")
    advice = advice_for_position(board, None)
    assert _keys(advice) == ["coach.advice.chance_capture"]
    assert advice["comment"][0]["params"] == {"piece": "♞d5"}


# --- разбор партии -------------------------------------------------------------------------------------------------------

def test_attach_comments_uses_the_engine_reply():
    board = chess.Board(ITALIAN)
    moves = [{"uci": "c4f7", "best_move_uci": "e1g1", "classification": "Blunder"},
             {"uci": "e8f7", "best_move_uci": "e8f7", "classification": "Best"}]
    attach_coach_comments(board, moves, ["e1g1", "e8f7", "f3g5"])
    assert "coach.threat.hanging" in _keys(moves[0]["coach"])


def test_without_engine_there_are_no_comments(monkeypatch):
    monkeypatch.setattr(analysis_module, "resolve_stockfish_path", lambda *a, **k: None)
    report = analysis_module._evaluate_board_sequence_sync('[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n', 5)
    assert report["format_version"] == ANALYSIS_FORMAT_VERSION
    assert all(move["coach"] is None for move in report["moves"])


def test_cache_of_older_format_is_not_current():
    pgn = '[Result "*"]\n\n1. e4 e5 *'
    old = {"engine": "x", "moves": [{}, {}]}
    assert not is_current_analysis(old, pgn)
    assert is_current_analysis({**old, "format_version": ANALYSIS_FORMAT_VERSION}, pgn)
    assert not is_current_analysis({**old, "format_version": ANALYSIS_FORMAT_VERSION, "moves": [{}]}, pgn)


async def test_old_cached_analysis_is_not_served(client, db_session):
    white = User(username="cache_w", hashed_password="pw")
    black = User(username="cache_b", hashed_password="pw")
    db_session.add_all([white, black])
    await db_session.commit()
    old = {"engine": "x", "white": {}, "black": {}, "moves": [{"ply": 1}, {"ply": 2}]}
    game = Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED,
                pgn='[Result "*"]\n\n1. e4 e5 *', analysis_json=json.dumps(old))
    db_session.add(game)
    await db_session.commit()
    response = client.get(f"/api/v1/analysis/game/{game.id}")
    assert response.status_code == 200
    assert response.json() is None


# --- POST /analysis/advice ------------------------------------------------------------------------------------------------

@pytest.fixture
def no_engine(monkeypatch):
    from src.services import move_check

    monkeypatch.setattr(move_check, "resolve_stockfish_path", lambda *a, **k: None)


def test_advice_endpoint(client, no_engine):
    response = client.post(ADVICE_URL, json={"fen": MATE_IN_ONE})
    assert response.status_code == 200
    body = response.json()
    assert body["best_move_uci"] is None and body["eval_cp"] is None
    assert body["comment"][0]["key"].startswith("coach.advice.chance_mate.")
    assert body["arrows"] == [{"from": "h5", "to": "f7", "kind": "best"}]


@pytest.mark.parametrize("fen, code", [
    ("not a fen", "invalid_fen"),
    ("8/8/8/8/8/8/8/8 w - - 0 1", "invalid_position"),
    ("r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4", "game_already_over"),
])
def test_advice_rejects_bad_positions_with_codes(client, no_engine, fen, code):
    response = client.post(ADVICE_URL, json={"fen": fen})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == code


async def test_advice_is_closed_during_a_game_with_a_person(client, no_engine, test_user_1, test_user_2, token_user_1):
    await state_manager.initialize_game(
        game_id=611, white_id=test_user_1.id, black_id=test_user_2.id, base_time_ms=180000, increment_ms=0,
    )
    response = client.post(ADVICE_URL, json={"fen": MATE_IN_ONE}, headers={"Authorization": f"Bearer {token_user_1}"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "engine_locked_in_game"


def test_advice_has_its_own_rate_limit(client, no_engine, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "RATE_LIMIT_ADVICE_GUEST", 2)
    for _ in range(2):
        assert client.post(ADVICE_URL, json={"fen": MATE_IN_ONE}).status_code == 200
    limited = client.post(ADVICE_URL, json={"fen": MATE_IN_ONE})
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "engine_rate_limited"
    # Анализ позиции считается отдельно — совет его квоту не тратит.
    assert client.post("/api/v1/analysis/position", json={"moves": []}).status_code == 200
