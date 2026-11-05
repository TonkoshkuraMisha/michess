# --- FILE: src/services/anticheat.py ---

import logging
import math
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.move import Move
from src.models.user import User

logger = logging.getLogger(__name__)

MIN_MOVES_FOR_ANALYSIS = 5
OPENING_MOVE_CUTOFF = 8
CHEATER_TRUST_THRESHOLD = 30


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
    исключая предходы (is_premove == True). Возвращает (cv, mean_time_ms).
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
    """Вычисляет штраф к фактору доверия по паттернам Tab-Switch и Timing Variance."""
    if len(moves) < MIN_MOVES_FOR_ANALYSIS:
        return {
            "penalty": 0,
            "blur_ratio": 0.0,
            "timing_cv": 1.0,
            "mean_time_ms": 0.0,
        }

    blur_ratio = calculate_blur_ratio(moves)
    timing_cv, mean_time_ms = calculate_timing_cv(moves)

    penalty = 0

    if blur_ratio >= 0.75:
        penalty += 45
    elif blur_ratio >= 0.50:
        penalty += 25
    elif blur_ratio >= 0.35:
        penalty += 12

    is_engine_pacing = 1500.0 <= mean_time_ms <= 15000.0
    if is_engine_pacing:
        if timing_cv <= 0.12:
            penalty += 40
        elif timing_cv <= 0.22:
            penalty += 22

    if blur_ratio >= 0.65 and is_engine_pacing and timing_cv <= 0.20:
        penalty += 15

    return {
        "penalty": penalty,
        "blur_ratio": blur_ratio,
        "timing_cv": timing_cv,
        "mean_time_ms": mean_time_ms,
    }


async def evaluate_game_telemetry(db: AsyncSession, game_id: int) -> dict[int, dict]:
    """
    Анализирует телеметрию завершённой партии для обоих игроков,
    снижает user.trust_factor при аномалиях и выставляет is_cheater = True при trust_factor < 30.
    """
    game = await db.get(Game, game_id)
    if not game:
        return {}

    result = await db.execute(
        select(Move).where(Move.game_id == game_id).order_by(Move.id.asc())
    )
    all_moves = list(result.scalars().all())
    if not all_moves:
        return {}

    moves_by_player: dict[int, list[Move]] = {
        game.white_player_id: [],
        game.black_player_id: [],
    }
    for move in all_moves:
        moves_by_player.setdefault(move.player_id, []).append(move)

    report: dict[int, dict] = {}

    for player_id, player_moves in moves_by_player.items():
        metrics = compute_telemetry_penalty(player_moves)
        penalty = metrics["penalty"]

        user = await db.get(User, player_id)
        if not user:
            continue

        if penalty > 0:
            user.trust_factor = max(0, int(user.trust_factor) - penalty)
            if user.trust_factor < CHEATER_TRUST_THRESHOLD:
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

        report[player_id] = {
            **metrics,
            "trust_factor": user.trust_factor,
            "is_cheater": user.is_cheater,
        }

    await db.commit()
    return report
