# --- FILE: src/services/move_check.py ---
"""
Игра с наставником (таск 11.3): проверка хода игрока и общий кэш оценок позиций.

`check_move` оценивает позицию до хода и после него (лучший ход, лучший ответ соперника), считает потерю в
сантипешках и классификацию — по тем же правилам, что полный разбор партии, — и собирает объяснение наставника
(src/services/coach.py). Решение, предупреждать ли игрока, принимает клиент по уровню игрока: сервер отдаёт факты.

Экономия движка: оценка позиции кэшируется в Redis по FEN (без счётчиков ходов) на CACHE_TTL_S. Совет по позиции,
проверка хода и повторная проверка после возврата хода не считают одну и ту же позицию дважды. Ход бота сюда не
относится намеренно: бот ищет ход движком на ограниченной силе (UCI_Elo) и со своим стилем — оценка полной силы
изменила бы его игру.

Без Stockfish проверка недоступна (`available: false`): оценка статического анализатора недостоверна, и
предупреждать по ней о «зевках» нельзя.
"""

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass

import chess
import chess.engine

from src.core.errors import DomainValueError
from src.db import redis as redis_module
from src.services.bots.base import resolve_stockfish_path
from src.services.coach import HINT_STEPS, advice_for_position, comment_for_move, hint_for_position
from src.services.engine_pool import EngineUnavailableError, get_engine_pool
from src.services.game_engine import board_from_start_fen

logger = logging.getLogger(__name__)

CACHE_TTL_S = 600
ENGINE_DEPTH = 12
ENGINE_TIME_S = 0.15
EVAL_CLAMP_CP = 2000
MATE_CP = 10_000

# Тактика, которую лучший ход создавал, а сделанный — нет: «пропущенный удар» (наставник предупреждает и при
# небольшой потере). Взятие и «обычный лучший ход» сюда не входят.
MISSED_TACTIC_PREFIXES = (
    "coach.missed.",
    "coach.best.mate.", "coach.best.fork.", "coach.best.skewer.", "coach.best.pin_absolute.",
    "coach.best.discovered_attack.", "coach.best.discovered_check.", "coach.best.double_check.",
    "coach.best.mate_threat.", "coach.best.trapped.",
)


@dataclass(frozen=True)
class PositionEval:
    """Оценка позиции с точки зрения белых (мат — ±MATE_CP), мат в N (знак — чей), лучший ход."""
    cp_white: int
    mate: int | None
    best_uci: str | None


def _cache_key(board: chess.Board) -> str:
    # Позиция без счётчиков полуходов и ходов: одна и та же позиция — один ключ.
    return f"engine:eval:{ENGINE_DEPTH}:{' '.join(board.fen().split()[:4])}"


def engine_evaluate(board: chess.Board) -> PositionEval | None:
    """Оценка Stockfish (синхронно, через пул). None — движка нет."""
    if board.is_checkmate():
        return PositionEval(-MATE_CP if board.turn == chess.WHITE else MATE_CP, 0, None)
    if board.is_game_over():
        return PositionEval(0, None, None)
    sf_path = resolve_stockfish_path()
    if not sf_path:
        return None
    with get_engine_pool(sf_path).acquire() as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=ENGINE_DEPTH, time=ENGINE_TIME_S))
    if isinstance(info, list):
        info = info[0]
    score = info["score"].white()
    pv = info.get("pv")
    return PositionEval(
        cp_white=int(score.score(mate_score=MATE_CP) or 0),
        mate=score.mate(),
        best_uci=pv[0].uci() if pv else None,
    )


async def evaluate_cached(board: chess.Board) -> PositionEval | None:
    """Оценка из кэша или от движка (с записью в кэш). Redis недоступен — просто считаем."""
    key = _cache_key(board)
    try:
        raw = await redis_module.redis_client.get(key)
        if raw:
            return PositionEval(**json.loads(raw))
    except Exception as exc:  # кэш — оптимизация, не условие работы
        logger.warning("Кэш оценок недоступен: %s", exc)
    try:
        result = await asyncio.to_thread(engine_evaluate, board.copy(stack=False))
    except EngineUnavailableError as exc:
        logger.warning("Stockfish недоступен для проверки хода: %s", exc)
        return None
    if result is not None:
        try:
            await redis_module.redis_client.set(key, json.dumps(asdict(result)), ex=CACHE_TTL_S)
        except Exception as exc:
            logger.warning("Кэш оценок недоступен: %s", exc)
    return result


def _clamped(cp_white: int) -> int:
    return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, cp_white))


def _parse_position(fen: str) -> chess.Board:
    board = board_from_start_fen(fen)  # invalid_fen / invalid_position
    if board.is_game_over():
        raise DomainValueError("game_already_over")
    return board


async def check_move(fen: str, move_uci: str) -> dict:
    """
    Проверка хода игрока: потеря (сп, с точки зрения сходившего), классификация, оценки до и после, лучший ход,
    лучший ответ соперника, «пропущенный удар» и объяснение наставника.
    """
    from src.services.analysis_service import classify_move_by_cp_loss  # без цикла импорта

    board = _parse_position(fen)
    try:
        move = chess.Move.from_uci(move_uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=move_uci) from None
    if move not in board.legal_moves:
        raise DomainValueError("illegal_move", move=move_uci)

    before = await evaluate_cached(board)
    after_board = board.copy(stack=False)
    after_board.push(move)
    after = await evaluate_cached(after_board)
    if before is None or after is None:
        return {"available": False}

    mover_sign = 1 if board.turn == chess.WHITE else -1
    cp_loss = max(0, mover_sign * (_clamped(before.cp_white) - _clamped(after.cp_white)))
    is_best = before.best_uci == move.uci()
    if is_best:
        cp_loss = 0
    classification, symbol = classify_move_by_cp_loss(cp_loss, is_best_move=is_best)
    coach = comment_for_move(board, move, before.best_uci, after.best_uci, classification)
    keys = [sentence["key"] for sentence in (coach or {}).get("comment", [])]
    return {
        "available": True,
        "cp_loss": cp_loss,
        "classification": classification,
        "symbol": symbol,
        # Оценки — с точки зрения сходившего: клиенту не нужно помнить, чей был ход.
        "eval_before": mover_sign * _clamped(before.cp_white),
        "eval_after": mover_sign * _clamped(after.cp_white),
        "best_move_uci": before.best_uci,
        "reply_uci": after.best_uci,
        "missed_tactic": any(key.startswith(MISSED_TACTIC_PREFIXES) for key in keys),
        "coach": coach,
    }


async def advise(fen: str) -> dict:
    """Совет по позиции (таск 11.2) — с оценкой из того же кэша, что проверка хода."""
    board = _parse_position(fen)
    evaluation = await evaluate_cached(board)
    best = evaluation.best_uci if evaluation else None
    return {
        "fen": board.fen(),
        "best_move_uci": best,
        "eval_cp": _clamped(evaluation.cp_white) if evaluation else None,
        **advice_for_position(board, best),
    }


async def hint(fen: str, step: int) -> dict:
    """Подсказка по ступеням (таск 11.4). Лучший ход раскрывается только на последней ступени."""
    board = _parse_position(fen)
    evaluation = await evaluate_cached(board)
    best = evaluation.best_uci if evaluation else None
    payload = hint_for_position(board, best, step)
    final = step >= HINT_STEPS or (step == 2 and best is None)
    return {
        "fen": board.fen(),
        "step": HINT_STEPS if final else step,
        "final": final,
        "best_move_uci": best if final else None,
        **payload,
    }


DISPUTES_KEY = "coach:disputes"
DISPUTES_KEEP = 2000


async def record_dispute(fen: str, move_uci: str, cp_loss: int | None, user_id: int | None) -> None:
    """
    «Не согласен» с предупреждением наставника: позиция и ход — в очередь спорных оценок (Redis, последние
    DISPUTES_KEEP). Её разбирают глубоким анализом (scripts/dev/review_disputes.py) — так находятся ошибки
    объяснений и порогов. Ход проверяется на легальность, чтобы очередь не засоряли.
    """
    board = _parse_position(fen)
    try:
        move = chess.Move.from_uci(move_uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=move_uci) from None
    if move not in board.legal_moves:
        raise DomainValueError("illegal_move", move=move_uci)
    entry = {"fen": board.fen(), "move": move.uci(), "cp_loss": cp_loss, "user_id": user_id, "at": int(time.time())}
    try:
        await redis_module.redis_client.lpush(DISPUTES_KEY, json.dumps(entry))
        await redis_module.redis_client.ltrim(DISPUTES_KEY, 0, DISPUTES_KEEP - 1)
    except Exception as exc:
        logger.warning("Очередь спорных оценок недоступна: %s", exc)
