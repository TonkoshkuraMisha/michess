# --- FILE: tests/test_engine_endpoints.py ---
"""
Защита эндпоинтов, нагружающих Stockfish: запрет анализа идущих партий, лимиты частоты,
503 при занятом пуле и сам пул долгоживущих движков.
"""

import json
import threading

import chess
import chess.engine
import pytest

from src.api import analysis as analysis_api
from src.core.config import settings
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.bots.base import resolve_stockfish_path
from src.services.engine_pool import EngineBusyError, EnginePool

SF_PATH = resolve_stockfish_path()
needs_stockfish = pytest.mark.skipif(SF_PATH is None, reason="Stockfish binary not available")

FOUR_PLY_PGN = '[Event "t"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *'


async def _make_game(db_session, status: GameStatus, pgn: str = FOUR_PLY_PGN, analysis_json: str | None = None):
    white = User(
        username=f"w_{status.name}", hashed_password="pw", bullet_rating=1500,
        blitz_rating=1500, rapid_rating=1500, classical_rating=1500
    )
    black = User(
        username=f"b_{status.name}", hashed_password="pw", bullet_rating=1500,
        blitz_rating=1500, rapid_rating=1500, classical_rating=1500
    )
    db_session.add_all([white, black])
    await db_session.commit()
    game = Game(
        white_player_id=white.id,
        black_player_id=black.id,
        status=status,
        base_time_ms=180000,
        increment_ms=0,
        is_rated=True,
        pgn=pgn,
        analysis_json=analysis_json,
    )
    db_session.add(game)
    await db_session.commit()
    return game


# --- Анализ идущих партий ---------------------------------------------------------------

async def test_analysis_of_in_progress_game_is_forbidden(client, db_session):
    game = await _make_game(db_session, GameStatus.IN_PROGRESS)

    post = client.post(f"/api/v1/analysis/game/{game.id}")
    get = client.get(f"/api/v1/analysis/game/{game.id}")

    assert post.status_code == 409
    assert get.status_code == 409
    assert not analysis_api._ANALYSIS_LOCKS  # лок по партии освобождён и удалён


async def test_cached_analysis_of_finished_game_is_available(client, db_session):
    game = await _make_game(db_session, GameStatus.COMPLETED)
    assert client.get(f"/api/v1/analysis/game/{game.id}").status_code == 200


@needs_stockfish
async def test_stale_cache_is_recomputed(client, db_session):
    """Кэш, посчитанный по неполной партии (например, во время игры), не отдаётся как итоговый."""
    stale = {"engine": "x", "white": {}, "black": {}, "moves": [{"ply": 1}, {"ply": 2}]}
    game = await _make_game(db_session, GameStatus.COMPLETED, analysis_json=json.dumps(stale))

    res = client.post(f"/api/v1/analysis/game/{game.id}")
    assert res.status_code == 200
    assert len(res.json()["moves"]) == 4


# --- Лимиты частоты ---------------------------------------------------------------------

def test_rate_limit_returns_429_with_retry_after(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_POSITION_ANALYSIS", 2)

    codes = [client.post("/api/v1/analysis/position", json={"moves": []}).status_code for _ in range(3)]

    assert codes[:2] == [200, 200]
    assert codes[2] == 429
    limited = client.post("/api/v1/analysis/position", json={"moves": []})
    assert int(limited.headers["Retry-After"]) >= 1


def test_rate_limit_is_per_user_when_token_present(client, monkeypatch, token_user_1, token_user_2):
    monkeypatch.setattr(settings, "RATE_LIMIT_POSITION_ANALYSIS", 1)
    url = "/api/v1/analysis/position"

    assert client.post(url, json={"moves": []}).status_code == 200  # гость (IP)
    assert client.post(url, json={"moves": []}).status_code == 429
    for token in (token_user_1, token_user_2):
        res = client.post(url, json={"moves": []}, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200


def test_engine_busy_maps_to_503(client, monkeypatch):
    async def _busy(*args, **kwargs):
        raise EngineBusyError("busy")

    monkeypatch.setattr(analysis_api.analysis_service, "analyze_position", _busy)
    res = client.post("/api/v1/analysis/position", json={"moves": []})
    assert res.status_code == 503
    assert "Retry-After" in res.headers


def test_bot_list_does_not_leak_engine_path(client):
    body = client.get("/api/v1/bots/list").json()
    assert "stockfish_path" not in body


# --- Пул движков ------------------------------------------------------------------------

class _FakeEngine:
    def __init__(self):
        self.options = {
            "Skill Level": chess.engine.Option("Skill Level", "spin", 20, 0, 20, []),
            "UCI_LimitStrength": chess.engine.Option("UCI_LimitStrength", "check", False, None, None, []),
            "UCI_Elo": chess.engine.Option("UCI_Elo", "spin", 1320, 1320, 3190, []),
        }
        self.configured: dict = {}

    def configure(self, options: dict):
        self.configured = dict(options)


def test_pool_resets_and_clamps_options():
    engine = _FakeEngine()
    EnginePool._configure(engine, {"Skill Level": 3, "UCI_LimitStrength": True, "UCI_Elo": 900, "Unknown": 1})
    assert engine.configured == {"Skill Level": 3, "UCI_LimitStrength": True, "UCI_Elo": 1320}

    # Следующий вызов без опций возвращает полную силу — настройки бота не «протекают».
    EnginePool._configure(engine, {})
    assert engine.configured == {"Skill Level": 20, "UCI_LimitStrength": False}


@needs_stockfish
def test_pool_reuses_process_and_limits_concurrency():
    pool = EnginePool(SF_PATH, size=1, acquire_timeout_s=0.2)
    try:
        with pool.acquire() as first:
            pass
        with pool.acquire() as second:
            assert second is first  # процесс переиспользован, а не запущен заново

            errors = []

            def _try_acquire():
                try:
                    with pool.acquire():
                        pass
                except EngineBusyError as exc:
                    errors.append(exc)

            t = threading.Thread(target=_try_acquire)
            t.start()
            t.join()
            assert len(errors) == 1
    finally:
        pool.close()


@needs_stockfish
def test_pool_replaces_dead_engine():
    pool = EnginePool(SF_PATH, size=1, acquire_timeout_s=1.0)
    try:
        with pool.acquire() as engine:
            engine.quit()  # процесс завершился, а вызывающий код ошибку «проглотил»
        with pool.acquire() as fresh:
            assert fresh is not engine
            info = fresh.analyse(chess.Board(), chess.engine.Limit(depth=1))
            assert "score" in info
    finally:
        pool.close()
