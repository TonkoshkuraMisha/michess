# --- FILE: src/services/tournament_career.py ---
"""
Карьера турниров (таск 15.4): лестница готовых турниров нарастающей силы и случайные соперники из диапазона.

Лестница — MAIN_STAGES основных турниров: сила соперников растёт от START_TARGET до END_TARGET, размер — 4, 6 или 8
(по трети лестницы), формат и контроль времени чередуются. Следующий основной турнир открывается, когда предыдущий
закончен в верхней половине таблицы. После каждого INVITATIONAL_EVERY-го основного идёт турнир-приглашение (всего
MAIN_STAGES // INVITATIONAL_EVERY): он скрыт (игрок видит только «???»), открывается местом в тройке в своём «воротном»
основном турнире и сильнее его на INVITATIONAL_BONUS.

Соперники этапа не хранятся: это участники ростера (исторические боты и архетипы мастерской), ближайшие по силе к цели
этапа — набор детерминирован, пока не меняется калибровка (bots/calibration.py).

Прогресс — лучшие места игрока в законченных турнирах карьеры (таблицы tournaments.career_stage и tournament_players).
Вызывает модуль src/api/tournaments.py; сам турнир создаёт tournaments.create_tournament.
"""

import random
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.tournament import Tournament, TournamentPlayer
from src.models.user import User
from src.services import tournaments as tournaments_service
from src.services.bots.archetypes import ARCHETYPE_PREFIX, ARCHETYPES
from src.services.bots.calibration import strength_of
from src.services.rating import classify_time_control

# Число основных турниров лестницы.
MAIN_STAGES = 24
# Целевая сила соперников первого и последнего основного турнира (по калибровке); между ними — линейно.
START_TARGET, END_TARGET = 800, 2200
# После каждого стольки-го основного турнира идёт приглашение; оно сильнее своего «воротного» на INVITATIONAL_BONUS.
INVITATIONAL_EVERY = 4
INVITATIONAL_BONUS = 150
# Контроли времени этапов (базовое время, прибавка — мс); этапы берут их по кругу.
TIME_CONTROLS = ((300_000, 0), (600_000, 0), (180_000, 2_000), (900_000, 10_000))
# Режим случайного турнира: соперники около уровня игрока, сильнее или слабее.
RandomMode = Literal["my_level", "stronger", "weaker"]
# Сдвиг центра подбора случайных соперников относительно рейтинга игрока по режимам.
RANDOM_SHIFT: dict[str, int] = {"my_level": 0, "stronger": 200, "weaker": -200}


@dataclass(frozen=True)
class Stage:
    """
    Этап карьеры: формат, число участников, контроль времени и целевая сила соперников. gate — основной турнир, место
    в тройке которого открывает это приглашение.
    """
    key: str
    number: int
    format: tournaments_service.Format
    size: int
    base_time_ms: int
    increment_ms: int
    target: int
    # Приглашение: скрыто, пока не занято место в тройке в турнире gate.
    gate: str | None = None


def _main_stage(i: int) -> Stage:
    """Основной этап с индексом i (с нуля): размер — по трети лестницы; на выбывание — каждый третий, размеров 4 и 8."""
    size = 4 if i < 8 else 6 if i < 16 else 8
    # На выбывание — только размеры 4 и 8 (шесть не годится для сетки): каждый третий турнир лестницы.
    fmt: tournaments_service.Format = "knockout" if size != 6 and i % 3 == 2 else "round_robin"
    base, inc = TIME_CONTROLS[i % len(TIME_CONTROLS)]
    target = START_TARGET + round((END_TARGET - START_TARGET) * i / (MAIN_STAGES - 1))
    return Stage(f"main-{i + 1}", i + 1, fmt, size, base, inc, target)


def _build() -> tuple[Stage, ...]:
    """Собирает всю лестницу: основные этапы и приглашение после каждого INVITATIONAL_EVERY-го."""
    stages: list[Stage] = []
    invitational = 0
    for i in range(MAIN_STAGES):
        stage = _main_stage(i)
        stages.append(stage)
        if (i + 1) % INVITATIONAL_EVERY == 0:
            invitational += 1
            base, inc = TIME_CONTROLS[(i + 1) % len(TIME_CONTROLS)]
            stages.append(Stage(f"invitational-{invitational}", invitational, "round_robin", 4, base, inc,
                                stage.target + INVITATIONAL_BONUS, gate=stage.key))
    return tuple(stages)


# Все этапы карьеры по порядку; по ключу — STAGES_BY_KEY.
STAGES: tuple[Stage, ...] = _build()
STAGES_BY_KEY = {stage.key: stage for stage in STAGES}


def roster() -> list[tuple[tournaments_service.ParticipantSpec, int]]:
    """Возможные соперники и их сила (по калибровке): исторические боты и архетипы."""
    entries: list[tuple[tournaments_service.ParticipantSpec, int]] = []
    for bot_id, declared in tournaments_service._bot_ratings().items():
        entries.append((tournaments_service.ParticipantSpec("bot", bot_id), strength_of(bot_id, declared).rating))
    for archetype in ARCHETYPES:
        entries.append((tournaments_service.ParticipantSpec("archetype", archetype.key.removeprefix(ARCHETYPE_PREFIX)),
                        strength_of(archetype.key, archetype.config.target_elo).rating))
    return sorted(entries, key=lambda item: (item[1], str(item[0].id)))


def nearest(target: int, count: int) -> list[tournaments_service.ParticipantSpec]:
    """count соперников, ближайших по силе к target (при равенстве — по id)."""
    ranked = sorted(roster(), key=lambda item: (abs(item[1] - target), str(item[0].id)))
    return [spec for spec, _ in ranked[:count]]


def stage_opponents(stage: Stage) -> list[tournaments_service.ParticipantSpec]:
    """Соперники этапа: size − 1 ближайших по силе к цели этапа (игрок — ещё один участник)."""
    return nearest(stage.target, stage.size - 1)


def random_opponents(rating: int, mode: RandomMode, count: int, rng: random.Random | None = None,
                     ) -> list[tournaments_service.ParticipantSpec]:
    """Случайные соперники около rating (+ сдвиг режима): выбор из 2·count ближайших по силе."""
    pool = nearest(rating + RANDOM_SHIFT[mode], min(len(roster()), count * 2))
    if len(pool) < count:
        raise DomainError("tournament_participants_count", expected=count)
    return (rng or random.Random()).sample(pool, count)


async def best_places(db: AsyncSession, user: User) -> dict[str, int]:
    """Лучшее место игрока в каждом законченном (и не сданном) турнире карьеры."""
    rows = (await db.execute(
        select(Tournament.career_stage, TournamentPlayer.place)
        .join(TournamentPlayer, (TournamentPlayer.tournament_id == Tournament.id) & (TournamentPlayer.user_id == user.id))
        .where(Tournament.owner_id == user.id, Tournament.career_stage.is_not(None), Tournament.status == "finished",
               Tournament.withdrawn_at.is_(None), TournamentPlayer.place.is_not(None))
    )).all()
    best: dict[str, int] = {}
    for key, place in rows:
        best[key] = min(best.get(key, place), place)
    return best


def unlocked(stage: Stage, best: dict[str, int]) -> bool:
    """
    Открыт ли этап при лучших местах best: приглашение — место в тройке в «воротном» турнире; основной — предыдущий
    закончен в верхней половине таблицы; первый открыт всегда.
    """
    if stage.gate is not None:
        return best.get(stage.gate, 99) <= 3
    if stage.number == 1:
        return True
    previous = STAGES_BY_KEY[f"main-{stage.number - 1}"]
    return best.get(previous.key, 99) <= previous.size // 2


async def overview(db: AsyncSession, user: User) -> list[dict]:
    """
    Карьера игрока: этапы с лучшим занятым местом и признаком «открыт». Скрытое приглашение не раскрывает ни
    соперников, ни условий.
    """
    best = await best_places(db, user)
    result = []
    for stage in STAGES:
        is_open = unlocked(stage, best)
        hidden = stage.gate is not None and not is_open
        category = classify_time_control(stage.base_time_ms, stage.increment_ms)
        result.append({
            "key": stage.key, "number": stage.number, "invitational": stage.gate is not None, "hidden": hidden,
            "unlocked": is_open, "best_place": best.get(stage.key),
            # Скрытое приглашение не раскрывает ни соперников, ни условий.
            **({} if hidden else {
                "format": stage.format, "size": stage.size, "base_time_ms": stage.base_time_ms,
                "increment_ms": stage.increment_ms, "category": category, "target": stage.target,
                "opponents": [{"kind": s.kind, "id": s.id} for s in stage_opponents(stage)],
            }),
        })
    return result


async def start_stage(db: AsyncSession, user: User, key: str) -> Tournament:
    """Создаёт турнир этапа карьеры; закрытый этап — отказ."""
    stage = STAGES_BY_KEY.get(key)
    if stage is None:
        raise DomainError("career_stage_unknown", stage=key)
    if not unlocked(stage, await best_places(db, user)):
        raise DomainError("career_stage_locked", stage=key)
    return await tournaments_service.create_tournament(
        db, user, stage.format, stage.size, stage_opponents(stage), stage.base_time_ms, stage.increment_ms,
        career_stage=stage.key, progress_branch=branch_of(stage),
    )


def branch_of(stage: Stage) -> tuple[str, ...]:
    """
    Ветка прогресса этапа: основная лестница — все основные этапы (пока идёт один, следующий не начать);
    приглашение — само по себе (параллельно с лестницей, но не дважды сразу).
    """
    if stage.gate is not None:
        return (stage.key,)
    return tuple(s.key for s in STAGES if s.gate is None)
