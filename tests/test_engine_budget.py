# --- FILE: tests/test_engine_budget.py ---
"""
Бюджет движка (таск 23.3): время движка по видам работ, игроки за день для «процессора на игрока» и дневные квоты
бесплатного тарифа на дорогую работу — выключенные, пока их не включит FREE_TIER_LIMITS.
"""

import asyncio

import pytest
from prometheus_client import REGISTRY

from src.api import analysis as analysis_api
from src.core import observability
from src.core.config import settings
from src.core.errors import DomainValueError
from src.services import engine_pool
from src.services.engine_pool import EngineBusyError, EnginePool, current_engine_work, engine_work

FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
HINT = {"fen": FEN, "step": 1, "final": False, "best_move_uci": None, "comment": [], "arrows": [], "highlights": []}


def sample(name: str, kind: str) -> float:
    return REGISTRY.get_sample_value(name, {"kind": kind}) or 0.0


def test_outer_kind_wins_and_unknown_is_other():
    assert current_engine_work() == "other"
    with engine_work("simulation"), engine_work("bot_move"):  # ход бота в симуляции турнира — работа симуляции
        assert current_engine_work() == "simulation"
    with engine_work("free-for-all"):
        assert current_engine_work() == "other"
    assert current_engine_work() == "other"


async def test_kind_reaches_the_engine_thread():
    with engine_work("coach"):
        assert await asyncio.to_thread(current_engine_work) == "coach"


class _Engine:
    options: dict = {}

    def quit(self):
        pass


def test_pool_accounts_held_time_and_refusals(monkeypatch):
    pool = EnginePool("stockfish", size=1, acquire_timeout_s=0.01)
    monkeypatch.setattr(pool, "_spawn", lambda: _Engine())
    held_before = sample("michess_engine_seconds_total", "coach")
    busy_before = sample("michess_engine_busy_total", "coach")

    with engine_work("coach"), pool.acquire(), pytest.raises(EngineBusyError), pool.acquire():  # единственный движок занят
        pass
    assert sample("michess_engine_seconds_total", "coach") > held_before
    assert sample("michess_engine_busy_total", "coach") == busy_before + 1


async def test_active_players_are_counted_once_per_day(client, token_user_1, token_user_2):
    for token in (token_user_1, token_user_1, token_user_2):
        assert client.get("/api/v1/profile/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    await observability.refresh_active_players()
    assert REGISTRY.get_sample_value("michess_active_players_today") == 2
    assert "michess_engine_seconds_total" in client.get("/metrics").text


@pytest.fixture
def stub_hint(monkeypatch):
    """Подсказка без движка; ступень 3 — ошибка входных данных (400)."""
    calls = []

    async def hint(fen, step):
        if step == 3:
            raise DomainValueError("invalid_fen")
        calls.append(step)
        return {**HINT, "step": step}

    monkeypatch.setattr(analysis_api.analysis_service, "hint", hint)
    return calls


def hint(client, step: int):
    return client.post("/api/v1/analysis/hint", json={"fen": FEN, "step": step})


def test_coach_quota_is_off_without_the_flag(client, stub_hint, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "FREE_COACH_REQUESTS_PER_DAY", 1)
    assert settings.FREE_TIER_LIMITS is False
    assert [hint(client, 1).status_code for _ in range(3)] == [200, 200, 200]


def test_coach_quota_counts_only_completed_work(client, stub_hint, monkeypatch, freeze_rate_limit_window):
    monkeypatch.setattr(settings, "FREE_TIER_LIMITS", True)
    monkeypatch.setattr(settings, "FREE_COACH_REQUESTS_PER_DAY", 2)

    assert hint(client, 1).status_code == 200
    assert hint(client, 3).status_code == 400  # ошибка не съедает квоту
    assert hint(client, 2).status_code == 200
    refused = hint(client, 1)
    assert refused.status_code == 429
    detail = refused.json()["detail"]
    assert detail["code"] == "daily_limit_reached" and detail["params"]["limit"] == 2
    assert 1 <= detail["params"]["hours"] <= 24 and refused.headers["Retry-After"]
    assert stub_hint == [1, 2]  # отказ — до работы движка


def test_engine_seconds_label_set_is_bounded():
    assert set(engine_pool.ENGINE_WORK_KINDS) == {"bot_move", "analysis", "coach", "simulation", "puzzles", "other"}
