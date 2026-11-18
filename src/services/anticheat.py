# --- FILE: src/services/anticheat.py ---
"""
Античит по телеметрии ходов: после партии оценивает ритм игры и меняет фактор доверия игрока.

Откуда данные: таблица moves — время на ход по часам сервера, потеря фокуса окна и предходы (от клиента).
Основной сигнал — ровный «машинный» ритм: среднее время хода от 1,5 до 15 секунд при малом разбросе (коэффициент
вариации до 0,12 — штраф 40, до 0,22 — 22). Потеря фокуса окна сообщается клиентом и подделывается, поэтому сама
по себе не штрафует, а только усиливает штраф, когда ритм уже похож на движок: доля ходов с потерей фокуса от
0,35 — ещё 12, от 0,50 — 25, от 0,75 — 45, и ещё 15, если доля от 0,65 при вариации до 0,20. Предход исключается
из ритма, только если сервер сам видит почти мгновенный ход (trusted_premove).

Пороги ритма и фокуса записаны числами в compute_telemetry_penalty; из настроек (src/core/config.py) читается
только AC_PREMOVE_MAX_ELAPSED_MS.

Итог: штраф вычитается из users.trust_factor (начинается со 100); ниже CHEATER_TRUST_THRESHOLD ставится флаг
is_cheater и создаётся заявка модератору (src/services/moderation.py) — решение принимает человек. Партия
оценивается один раз (отметка в Redis, ключ anticheat:evaluated:{game_id}). Запросы движка с адреса игрока во время
партии только записываются как сигнал для разбора — штрафа за них нет. Вызывается при завершении партии
(src/services/game_state.py).
"""

import logging
import math

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.move import Move
from src.models.user import User

logger = logging.getLogger(__name__)

# Меньше стольких ходов игрока в партии — ритм не оценивается, штрафа нет.
MIN_MOVES_FOR_ANALYSIS = 5
# Доля ходов с потерей фокуса считается по ходам после этого номера хода (первые ходы партии не учитываются).
OPENING_MOVE_CUTOFF = 8
# Фактор доверия ниже этого значения — флаг is_cheater и заявка модератору.
CHEATER_TRUST_THRESHOLD = 30
# Срок жизни отметки «партия уже оценена» в Redis (90 дней): в этот срок повторная оценка не штрафует.
EVALUATED_MARKER_TTL_S = 90 * 24 * 60 * 60


def trusted_premove(client_flag, server_elapsed_ms: int) -> bool:
    """
    Премув исключает ход из анализа ритма, поэтому флаг клиента принимаем, только если сервер
    сам видит почти мгновенный ход (не дольше settings.AC_PREMOVE_MAX_ELAPSED_MS, по умолчанию 600 мс). Иначе читер
    мог бы пометить премувом все ходы.
    """
    from src.core.config import settings

    return bool(client_flag) and int(server_elapsed_ms) <= settings.AC_PREMOVE_MAX_ELAPSED_MS


async def _claim_first_evaluation(game_id: int) -> bool:
    """
    True, если партия оценивается впервые. Отметка хранится в Redis (SET NX), а не в памяти
    процесса: после рестарта или на другом воркере штраф за ту же партию не начислится снова. Ключ —
    anticheat:evaluated:{game_id}, срок — EVALUATED_MARKER_TTL_S. Redis недоступен — False: партия считается уже
    оценённой и штраф не начисляется.
    """
    from src.db import redis as redis_module

    try:
        claimed = await redis_module.redis_client.set(
            f"anticheat:evaluated:{int(game_id)}", "1", nx=True, ex=EVALUATED_MARKER_TTL_S,
        )
        return bool(claimed)
    except Exception as exc:
        logger.warning("Anti-cheat idempotency marker unavailable for game %s: %s", game_id, exc)
        return False  # без отметки не штрафуем: повторный штраф хуже пропущенного


def calculate_blur_ratio(moves: list[Move]) -> float:
    """
    Считает долю ходов с потерей фокуса окна (window_blurred_before_move == True)
    после 8-го хода. Если после 8-го хода менее 3 ходов, оценивает все ходы игрока.
    """
    if not moves:
        return 0.0

    post_opening = [m for m in moves if (m.move_number or 0) > OPENING_MOVE_CUTOFF]
    target_moves = post_opening if len(post_opening) >= 3 else moves

    blurred_count = sum(1 for m in target_moves if bool(m.window_blurred_before_move))
    return round(blurred_count / len(target_moves), 4)


def calculate_timing_cv(moves: list[Move]) -> tuple[float, float]:
    """
    Считает коэффициент вариации времени ходов (CV = std_dev / mean),
    исключая предходы (is_premove == True) и ходы без записанного времени. Возвращает (cv, mean_time_ms).
    Если таких ходов меньше трёх — (1.0, 0.0): по этим значениям штраф не начисляется.
    """
    normal_times = [
        float(m.time_taken_ms)
        for m in moves
        if not bool(m.is_premove) and (m.time_taken_ms or 0) > 0
    ]

    if len(normal_times) < 3:
        return 1.0, 0.0

    mean_time = sum(normal_times) / len(normal_times)
    if mean_time <= 0:
        return 1.0, 0.0

    variance = sum((t - mean_time) ** 2 for t in normal_times) / len(normal_times)
    std_dev = math.sqrt(variance)
    return round(std_dev / mean_time, 4), round(mean_time, 1)


def compute_telemetry_penalty(moves: list[Move]) -> dict:
    """
    Вычисляет штраф к фактору доверия по паттернам Tab-Switch и Timing Variance для ходов одного игрока в одной
    партии. Возвращает штраф и измеренные величины (доля ходов с потерей фокуса, вариация и среднее время хода).
    Меньше MIN_MOVES_FOR_ANALYSIS ходов — штраф 0. Наибольший возможный штраф за партию — 40 + 45 + 15 = 100.
    """
    if len(moves) < MIN_MOVES_FOR_ANALYSIS:
        return {
            "penalty": 0,
            "blur_ratio": 0.0,
            "timing_cv": 1.0,
            "mean_time_ms": 0.0,
        }

    blur_ratio = calculate_blur_ratio(moves)
    timing_cv, mean_time_ms = calculate_timing_cv(moves)

    # Основной сигнал — ритм ходов, который измеряет сервер (time_taken_ms — серверное время
    # между ходами). Потеря фокуса окна сообщается клиентом и подделывается в обе стороны,
    # поэтому сама по себе не штрафует (иначе страдают честные игроки со вторым монитором)
    # и лишь усиливает штраф, когда серверный ритм уже похож на движок.
    timing_penalty = 0
    is_engine_pacing = 1500.0 <= mean_time_ms <= 15000.0
    if is_engine_pacing:
        if timing_cv <= 0.12:
            timing_penalty = 40
        elif timing_cv <= 0.22:
            timing_penalty = 22

    blur_penalty = 0
    if timing_penalty > 0:
        if blur_ratio >= 0.75:
            blur_penalty = 45
        elif blur_ratio >= 0.50:
            blur_penalty = 25
        elif blur_ratio >= 0.35:
            blur_penalty = 12
        if blur_ratio >= 0.65 and timing_cv <= 0.20:
            blur_penalty += 15

    penalty = timing_penalty + blur_penalty

    return {
        "penalty": penalty,
        "blur_ratio": blur_ratio,
        "timing_cv": timing_cv,
        "mean_time_ms": mean_time_ms,
    }


async def evaluate_game_telemetry(db: AsyncSession, game_id: int, force: bool = False) -> dict[int, dict]:
    """
    Анализирует телеметрию завершённой партии для обоих игроков,
    снижает user.trust_factor при аномалиях и выставляет is_cheater = True при trust_factor < 30.
    Идемпотентна по game_id (повторный вызов для той же партии не штрафует игрока дважды); force=True пропускает
    проверку отметки и штрафует заново. Ходы берутся из таблицы moves. Возвращает по каждому игроку измеренные
    величины, число запросов движка с его адреса за партию, фактор доверия и флаг; партии или её ходов нет — {}.
    """
    from src.api.fair_play import engine_requests_during_game

    game = await db.get(Game, game_id)
    if not game:
        return {}

    result = await db.execute(
        select(Move).where(Move.game_id == game_id).order_by(Move.id.asc())
    )
    all_moves = list(result.scalars().all())
    if not all_moves:
        return {}

    already_evaluated = not force and not await _claim_first_evaluation(game_id)

    moves_by_player: dict[int, list[Move]] = {
        game.white_player_id: [],
        game.black_player_id: [],
    }
    for move in all_moves:
        moves_by_player.setdefault(move.player_id, []).append(move)

    report: dict[int, dict] = {}

    for player_id, player_moves in moves_by_player.items():
        metrics = compute_telemetry_penalty(player_moves)
        penalty = 0 if already_evaluated else metrics["penalty"]

        user = await db.get(User, player_id)
        if not user:
            continue

        if penalty > 0:
            user.trust_factor = max(0, int(user.trust_factor) - penalty)
            if user.trust_factor < CHEATER_TRUST_THRESHOLD:
                if not user.is_cheater:
                    # Флаг ставит автоматика, но решение проверяет модератор (таск 17.4): заявка в очередь.
                    from src.services.moderation import flag_for_review
                    await flag_for_review(db, user, game_id)
                user.is_cheater = True
                logger.warning(
                    "Fair Play Alert: user %s (id=%s) flagged in game %s (trust_factor=%s, blur=%.2f, cv=%.2f)",
                    user.username,
                    user.id,
                    game_id,
                    user.trust_factor,
                    metrics["blur_ratio"],
                    metrics["timing_cv"],
                )

        # Запросы движка другим аккаунтом с адреса игрока во время партии: только сигнал для
        # разбора — в одной сети могут быть разные люди, поэтому штрафа за него нет.
        engine_requests = await engine_requests_during_game(game_id, player_id)
        if engine_requests and not already_evaluated:
            logger.warning(
                "Fair Play signal: %s engine request(s) from the address of user %s (id=%s) during game %s",
                engine_requests, user.username, user.id, game_id,
            )

        report[player_id] = {
            **metrics,
            "engine_requests_same_ip": engine_requests,
            "trust_factor": user.trust_factor,
            "is_cheater": user.is_cheater,
        }

    await db.commit()
    return report
