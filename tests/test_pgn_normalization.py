# --- FILE: tests/test_pgn_normalization.py ---
"""
PGN с пустой строкой после каждой строки (архив чемпионов, импортированный на Windows: \\r\\r\\n).
По стандарту пустая строка завершает партию — сервер видел партию без ходов, и анализ движком
возвращал пустой отчёт «100 % точности» без графика.
"""

import importlib.util
import json
from pathlib import Path

import pytest

from src.db.seed import _split_pgn_games
from src.models.game import GameStatus
from src.services.analysis_service import analysis_service
from src.services.game_engine import normalize_pgn_text, read_pgn_game
from tests.test_engine_endpoints import _make_game

CLEAN = (
    '[Event "St Petersburg"]\n[White "Lasker, Emanuel"]\n[Black "Steinitz, William"]\n[Result "1-0"]\n\n'
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 d6\n4. d4 Bd7 1-0\n"
)
# Как хранилось в базе: пустая строка после каждой строки.
DAMAGED = CLEAN.replace("\n", "\n\n")


def test_damaged_pgn_used_to_lose_all_moves():
    import io

    import chess.pgn

    broken = chess.pgn.read_game(io.StringIO(DAMAGED))
    assert broken is not None and list(broken.mainline_moves()) == []


@pytest.mark.parametrize("raw", [DAMAGED, CLEAN, CLEAN.replace("\n", "\r\n"), CLEAN.replace("\n", "\r\r\n")])
def test_normalized_pgn_keeps_headers_and_all_moves(raw):
    game = read_pgn_game(raw)
    assert game is not None
    assert game.headers["White"] == "Lasker, Emanuel"
    assert len(list(game.mainline_moves())) == 8


def test_normalization_is_idempotent_and_keeps_clean_pgn():
    assert normalize_pgn_text(CLEAN) == CLEAN
    assert normalize_pgn_text(normalize_pgn_text(DAMAGED)) == normalize_pgn_text(DAMAGED) == CLEAN


def test_movetext_without_headers():
    assert normalize_pgn_text("\n1. e4 e5\n\n2. Nf3 *\n") == "1. e4 e5\n2. Nf3 *"


def test_seed_splits_windows_double_cr_file_into_clean_games():
    second = CLEAN.replace("St Petersburg", "Moscow")
    file_text = (CLEAN + "\n" + second).replace("\n", "\r\r\n")

    games = _split_pgn_games(file_text)

    assert games == [CLEAN, second]


def test_migration_repairs_only_damaged_rows():
    path = next(Path("migrations/versions").glob("a4d2e8f1c6b9_*.py"))
    spec = importlib.util.spec_from_file_location("normalize_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module._has_blank_line_inside(DAMAGED)
    assert not module._has_blank_line_inside(CLEAN)
    # Копия алгоритма в миграции совпадает с кодом приложения.
    assert module._normalize(DAMAGED) == normalize_pgn_text(DAMAGED)


@pytest.mark.asyncio
async def test_analysis_of_damaged_pgn_has_every_move_and_replaces_empty_cache(db_session):
    empty_cache = {"white": {"accuracy": 100.0}, "black": {"accuracy": 100.0}, "moves": []}
    report = await analysis_service.analyze_full_game(db_session, (await _make_game(
        db_session, GameStatus.COMPLETED, pgn=DAMAGED, analysis_json=json.dumps(empty_cache),
    )).id)

    assert len(report["moves"]) == 8
    assert [m["san"] for m in report["moves"][:2]] == ["e4", "e5"]
