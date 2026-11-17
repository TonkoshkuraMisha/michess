# --- FILE: src/services/bots/selfplay.py ---
"""
Настройка характера самоигрой (таск 32.3). Архетипы мастерской (по ним строятся лестница и турниры) регулярно
играют между собой — задача celery beat bot_selfplay в очереди simulation: каждый с соседом по силе. Итоги копятся
по архетипу; после TUNE_GAMES партий считается сила по игре (средний рейтинг соперников ± PERF_SPAN по доле очков).
Если она отличается от заявленной (target_elo) на DRIFT и больше, ползунки силы сдвигаются на шаг: сильнее
заявленного — больше разброс (randomness) и шире окно ходов (blunder_guard_cp), слабее — наоборот.

Границы стиля: разброс — не дальше RANDOMNESS_SPAN от исходного, окно — не дальше GUARD_SHARE от исходного; остальные
ползунки (агрессия, центр, привычки, дебюты) не трогаются — бот остаётся собой. Каждый сдвиг пишется в открытый
журнал (bot_tuning_log, страница прозрачности). Подстроенный характер получают каталог (клиент играет им в мастерской и
на лестнице), турниры и симуляция — через tuned_config; кэш процесса обновляется не чаще раза в REFRESH_SECONDS.

Опорный рейтинг соперника — его заявленная сила: все архетипы держатся около своей, соседи по силе меряют друг друга.
"""

import asyncio
import logging
import random
import time
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.bot_memory import BotTuning, BotTuningLog
from src.services.bots.archetypes import ARCHETYPES, ARCHETYPES_BY_KEY, Archetype
from src.services.bots.personality import BotPersonalityConfig

logger = logging.getLogger(__name__)

TUNE_GAMES = 20
DRIFT = 75
PERF_SPAN = 400
RANDOMNESS_STEP = 5
GUARD_STEP = 20
RANDOMNESS_SPAN = 15
GUARD_SHARE = 0.25
GAMES_PER_RUN = 12
REFRESH_SECONDS = 300

_tuned: dict[str, tuple[int, int]] = {}
_loaded_at = -float(REFRESH_SECONDS)


def bounds(base: BotPersonalityConfig) -> tuple[tuple[int, int], tuple[int, int]]:
    """Границы стиля для разброса и окна ходов архетипа."""
    randomness = (max(0, base.randomness - RANDOMNESS_SPAN), min(100, base.randomness + RANDOMNESS_SPAN))
    span = max(GUARD_STEP, round(base.blunder_guard_cp * GUARD_SHARE))
    guard = (max(0, base.blunder_guard_cp - span), min(400, base.blunder_guard_cp + span))
    return randomness, guard


def tuned_config(archetype: Archetype) -> BotPersonalityConfig:
    values = _tuned.get(archetype.key)
    if values is None:
        return archetype.config
    return archetype.config.model_copy(update={"randomness": values[0], "blunder_guard_cp": values[1]})


def forget() -> None:
    global _loaded_at
    _tuned.clear()
    _loaded_at = -float(REFRESH_SECONDS)


async def refresh(db: AsyncSession, *, force: bool = False) -> None:
    global _loaded_at
    if not force and time.monotonic() - _loaded_at < REFRESH_SECONDS:
        return
    rows = (await db.execute(select(BotTuning))).scalars().all()
    _tuned.clear()
    _tuned.update({r.key: (r.randomness, r.blunder_guard_cp) for r in rows if r.key in ARCHETYPES_BY_KEY})
    _loaded_at = time.monotonic()


def performance(points: float, games: int, opponents_rating: float) -> float:
    """Сила по игре: средний соперник плюс-минус PERF_SPAN по доле очков (линейная оценка, без крайностей)."""
    return opponents_rating / games + 2 * PERF_SPAN * (points / games - 0.5)


def step(base: BotPersonalityConfig, randomness: int, guard: int, measured: float) -> tuple[int, int]:
    gap = measured - base.target_elo
    if abs(gap) < DRIFT:
        return randomness, guard
    sign = 1 if gap > 0 else -1          # сильнее заявленного — ослабить
    (r_lo, r_hi), (g_lo, g_hi) = bounds(base)
    return (min(r_hi, max(r_lo, randomness + sign * RANDOMNESS_STEP)),
            min(g_hi, max(g_lo, guard + sign * GUARD_STEP)))


async def record_game(db: AsyncSession, key: str, opponent_rating: int, points: float) -> BotTuningLog | None:
    """Итог партии самоигры для архетипа; если копилка полна — проверка силы и, может быть, сдвиг. Коммит — здесь."""
    base = ARCHETYPES_BY_KEY[key].config
    row = await db.get(BotTuning, key)
    if row is None:
        row = BotTuning(key=key, randomness=base.randomness, blunder_guard_cp=base.blunder_guard_cp, games=0,
                        points=0.0, opponents_rating=0.0)
        db.add(row)
    row.games = (row.games or 0) + 1
    row.points = (row.points or 0.0) + points
    row.opponents_rating = (row.opponents_rating or 0.0) + opponent_rating
    entry = None
    if row.games >= TUNE_GAMES:
        measured = performance(row.points, row.games, row.opponents_rating)
        randomness, guard = step(base, row.randomness, row.blunder_guard_cp, measured)
        if (randomness, guard) != (row.randomness, row.blunder_guard_cp):
            entry = BotTuningLog(key=key, games=row.games, measured=round(measured), target=base.target_elo,
                                 randomness_before=row.randomness, randomness_after=randomness,
                                 guard_before=row.blunder_guard_cp, guard_after=guard)
            db.add(entry)
            logger.info("Self-play tuning %s: measured %.0f vs %s, randomness %s->%s, guard %s->%s", key, measured,
                        base.target_elo, row.randomness, randomness, row.blunder_guard_cp, guard)
        row.randomness, row.blunder_guard_cp = randomness, guard
        row.games, row.points, row.opponents_rating = 0, 0.0, 0.0
    await db.commit()
    _tuned[key] = (row.randomness, row.blunder_guard_cp)
    return entry


def pairings(rng: random.Random, games: int = GAMES_PER_RUN) -> list[tuple[Archetype, Archetype]]:
    """Соседи по силе; цвет — случайный. Каждый архетип встречается с тем, кто чуть сильнее или слабее."""
    ladder = sorted(ARCHETYPES, key=lambda a: a.config.target_elo)
    pairs = [(ladder[i], ladder[i + 1]) for i in range(len(ladder) - 1)]
    chosen = [rng.choice(pairs) for _ in range(games)] if pairs else []
    return [(a, b) if rng.random() < 0.5 else (b, a) for a, b in chosen]


async def run(db: AsyncSession, games: int = GAMES_PER_RUN, play: Callable | None = None,
              rng: random.Random | None = None) -> int:
    """Сыграть партии самоигры и записать итоги; возвращает число сыгранных партий."""
    from src.services import tournament_simulation as sim
    from src.services.bots.personality import PersonalityBot

    play = play or sim.play_game
    rng = rng or random.Random()
    await refresh(db, force=True)
    played = 0
    for white, black in pairings(rng, games):
        bots = []
        for archetype in (white, black):
            bot = PersonalityBot(tuned_config(archetype))
            bot.search_depth = min(bot.search_depth, sim.SIM_MAX_DEPTH)
            bot.time_limit = min(bot.time_limit, sim.SIM_TIME_LIMIT_S)
            bots.append(bot)
        _moves, result, _termination = await asyncio.to_thread(play, bots[0], bots[1])
        white_points = {"1-0": 1.0, "0-1": 0.0}.get(result, 0.5)
        await record_game(db, white.key, black.config.target_elo, white_points)
        await record_game(db, black.key, white.config.target_elo, 1.0 - white_points)
        played += 1
    return played


async def journal(db: AsyncSession, limit: int = 50) -> list[BotTuningLog]:
    return list((await db.execute(select(BotTuningLog).order_by(BotTuningLog.id.desc()).limit(limit))).scalars().all())
