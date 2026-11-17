# --- FILE: tests/test_bot_selfplay.py ---
"""Настройка характера самоигрой (таск 32.3): шаг в границах стиля, копилка партий, журнал, каталог."""

import random

import pytest

from src.models.bot_memory import BotTuning
from src.services.bots import selfplay
from src.services.bots.archetypes import ARCHETYPES

ARCH = sorted(ARCHETYPES, key=lambda a: a.config.target_elo)[len(ARCHETYPES) // 2]


@pytest.fixture(autouse=True)
def clean_cache():
    selfplay.forget()
    yield
    selfplay.forget()


def test_step_moves_toward_declared_strength_within_style_bounds():
    base = ARCH.config
    target = base.target_elo
    r, g = base.randomness, base.blunder_guard_cp
    # Сильнее заявленного — ослабить: больше разброс, шире окно.
    assert selfplay.step(base, r, g, target + 200) == (min(100, r + selfplay.RANDOMNESS_STEP), g + selfplay.GUARD_STEP)
    # Слабее — усилить.
    weaker = selfplay.step(base, r, g, target - 200)
    assert weaker[0] <= r and weaker[1] == g - selfplay.GUARD_STEP
    # Расхождение меньше порога — ничего не трогаем.
    assert selfplay.step(base, r, g, target + selfplay.DRIFT - 1) == (r, g)
    # Сколько ни ослабляй — не дальше границ стиля.
    (r_lo, r_hi), (g_lo, g_hi) = selfplay.bounds(base)
    for _ in range(50):
        r, g = selfplay.step(base, r, g, target + 500)
    assert (r, g) == (r_hi, g_hi) and r_hi - base.randomness <= selfplay.RANDOMNESS_SPAN


def test_performance_is_linear_around_the_opponents():
    assert selfplay.performance(5, 10, 10 * 1500) == 1500
    assert selfplay.performance(10, 10, 10 * 1500) == 1500 + selfplay.PERF_SPAN
    assert selfplay.performance(0, 10, 10 * 1500) == 1500 - selfplay.PERF_SPAN


async def test_full_bank_tunes_logs_and_resets(db_session, monkeypatch):
    monkeypatch.setattr(selfplay, "TUNE_GAMES", 4)
    target = ARCH.config.target_elo
    entries = [await selfplay.record_game(db_session, ARCH.key, target, 1.0) for _ in range(4)]
    assert entries[:3] == [None, None, None]
    log = entries[3]
    assert log is not None and log.measured == target + selfplay.PERF_SPAN and log.target == target
    assert log.randomness_after > log.randomness_before or log.randomness_after == 100
    row = await db_session.get(BotTuning, ARCH.key)
    assert (row.games, row.points) == (0, 0.0)                               # копилка начата заново
    tuned = selfplay.tuned_config(ARCH)
    assert tuned.blunder_guard_cp == log.guard_after
    assert (tuned.aggression, tuned.target_elo, tuned.habits) == (ARCH.config.aggression, target, ARCH.config.habits)


async def test_run_plays_neighbours_and_records_both_sides(db_session):
    calls = []

    def fake_play(white, black):
        calls.append((white.config.target_elo, black.config.target_elo))
        return ["e2e4"], "1-0", "adjudication"

    played = await selfplay.run(db_session, games=6, play=fake_play, rng=random.Random(3))
    assert played == 6 and len(calls) == 6
    ladder = sorted({a.config.target_elo for a in ARCHETYPES})
    for white, black in calls:                                                  # только соседи по силе
        assert abs(ladder.index(white) - ladder.index(black)) <= 1
    rows = {r.key: r for r in (await db_session.execute(BotTuning.__table__.select())).all()}
    assert sum(r.games for r in rows.values()) == 12


async def test_tuning_log_and_catalog_are_public(client, db_session, monkeypatch):
    monkeypatch.setattr(selfplay, "TUNE_GAMES", 2)
    for _ in range(2):
        await selfplay.record_game(db_session, ARCH.key, ARCH.config.target_elo, 0.0)
    selfplay.forget()
    log = client.get("/api/v1/bots/tuning-log").json()
    [entry] = log["entries"]
    assert entry["key"] == ARCH.key and entry["measured"] == ARCH.config.target_elo - selfplay.PERF_SPAN
    assert entry["blunder_guard_cp"][1] < entry["blunder_guard_cp"][0]       # слабее заявленного — окно уже
    assert log["rules"] == {"games": 2, "drift": selfplay.DRIFT}
    catalog = client.get("/api/v1/bots/catalog").json()
    shown = next(a for a in catalog["archetypes"] if a["id"] == ARCH.id)
    assert shown["config"]["blunder_guard_cp"] == entry["blunder_guard_cp"][1]
