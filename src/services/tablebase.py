# --- FILE: src/services/tablebase.py ---
"""
Эндшпильные таблицы (таск 14.4): API таблиц по адресу settings.TABLEBASE_URL — в разработке открытый сервер lichess
(tablebase.lichess.ovh, до 7 фигур), в продакшене — свой сервер таблиц с тем же API (DEPLOY). На сторонний сервер
уходит только позиция (FEN) — никаких данных игрока; клиент представляется общим именем (ATTRIBUTION, «Внешние
сервисы»). Ответ кэшируется в Redis: таблицы не меняются.

Результат с точки зрения стороны, которая ходит: category (win / draw / loss и их «проклятые» варианты по правилу
50 ходов), dtm и dtz — в полуходах (lichess отдаёт их так), лучший ход — первый в списке ответа (lichess сортирует
ходы от лучшего для ходящей стороны).

Запасной путь (таск 1 плана 18.11): сервер таблиц не ответил за TIMEOUT_S или ответил ошибкой — позицию оценивает
Stockfish из пула (engine_pool, глубина FALLBACK_DEPTH), чтобы тренажёр не падал. Ответ тогда помечен source="engine":
dtm и dtz неизвестны (null), категория — по оценке (engine_category): мат или перевес от ENGINE_WIN_CP — win / loss,
не больше ENGINE_DRAW_CP — draw, между ними — maybe-win / maybe-loss (клиент в этом коридоре партию не обрывает).
Ответ движка не кэшируется: таблицы могут снова стать доступны. Нет и движка — прежний отказ tablebase_unavailable.

Вызывает probe из POST /analysis/tablebase (src/api/analysis.py). Ключ Redis — «tablebase:<FEN>».
"""

import asyncio
import json
import logging

import chess
import chess.engine
import httpx

from src.core.config import settings
from src.core.errors import DomainError
from src.db import redis as redis_module
from src.services.bots.base import resolve_stockfish_path
from src.services.engine_pool import EngineUnavailableError, get_engine_pool

logger = logging.getLogger(__name__)

# Сколько ждать сервер таблиц: дольше игрок ждать ответа соперника не должен — дальше считает движок.
TIMEOUT_S = 1.5
# Больше фигур на доске таблицы не покрывают — отказ tablebase_too_many_pieces.
MAX_PIECES = 7
# Срок жизни ответа таблиц в Redis (30 суток): таблицы не меняются, срок лишь не даёт ключам копиться.
CACHE_TTL_S = 30 * 24 * 3600
# Общее имя клиента для стороннего сервера (без данных игрока).
USER_AGENT = "regence-endgame-trainer"
# Глубина запасного расчёта: в эндшпиле до семи фигур её хватает, чтобы найти мат и отличить выигрыш от ничьей.
FALLBACK_DEPTH = 18
# Оценка движка (сантипешки, для ходящей стороны) не меньше этой — выигрыш, не больше минус её — проигрыш.
ENGINE_WIN_CP = 400
# По модулю не больше этой — ничья. Между ENGINE_DRAW_CP и ENGINE_WIN_CP вердикт ненадёжен — maybe-win / maybe-loss.
ENGINE_DRAW_CP = 50


async def _fetch(fen: str) -> dict:
    """
    Запрос к API таблиц по settings.TABLEBASE_URL, ответ — JSON как у lichess. Ошибка сети или статуса —
    httpx.HTTPError (подменяется в тестах).
    """
    async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(settings.TABLEBASE_URL, params={"fen": fen})
        response.raise_for_status()
        return response.json()


def engine_category(score: chess.engine.Score) -> str:
    """Категория позиции для ходящей стороны по оценке движка (пороги — ENGINE_WIN_CP и ENGINE_DRAW_CP)."""
    mate = score.mate()
    if mate is not None:
        return "win" if mate > 0 else "loss"
    cp = score.score() or 0
    if cp >= ENGINE_WIN_CP:
        return "win"
    if cp <= -ENGINE_WIN_CP:
        return "loss"
    if abs(cp) <= ENGINE_DRAW_CP:
        return "draw"
    return "maybe-win" if cp > 0 else "maybe-loss"


def _engine_probe(board: chess.Board) -> dict:
    """Запасной ответ движка в формате probe (синхронно — вызывается в потоке). Нет бинарника — EngineUnavailableError."""
    path = resolve_stockfish_path()
    if not path:
        raise EngineUnavailableError("stockfish not found")
    with get_engine_pool(path).acquire() as engine:
        info = engine.analyse(board, chess.engine.Limit(depth=FALLBACK_DEPTH))
    if isinstance(info, list):
        info = info[0]
    pv = info.get("pv") or []
    best = None
    if pv and pv[0] in board.legal_moves:
        best = {"uci": pv[0].uci(), "san": board.san(pv[0]), "category": None, "dtm": None, "dtz": None}
    return {"category": engine_category(info["score"].relative), "dtm": None, "dtz": None, "best": best,
            "source": "engine"}


async def probe(board: chess.Board) -> dict:
    """
    {category, dtm, dtz, best: {uci, san, category, dtm, dtz} | None, source} для стороны, которая ходит. source —
    "tablebase" (точный ответ таблиц) или "engine" (сервер таблиц недоступен, см. описание модуля).
    """
    if len(board.piece_map()) > MAX_PIECES:
        raise DomainError("tablebase_too_many_pieces", max=MAX_PIECES)
    fen = board.fen()
    key = f"tablebase:{fen}"
    cached = await redis_module.redis_client.get(key)
    if cached:
        data = json.loads(cached)
    else:
        try:
            data = await _fetch(fen)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Tablebase request failed, falling back to the engine: %s", exc)
            try:
                return await asyncio.to_thread(_engine_probe, board.copy(stack=False))
            except EngineUnavailableError as engine_exc:
                raise DomainError("tablebase_unavailable") from engine_exc
        await redis_module.redis_client.set(key, json.dumps(data), ex=CACHE_TTL_S)
    moves = data.get("moves") or []
    best = None
    if moves:
        first = moves[0]
        move = chess.Move.from_uci(first["uci"])
        if move in board.legal_moves:
            best = {"uci": first["uci"], "san": board.san(move), "category": first.get("category"),
                    "dtm": first.get("dtm"), "dtz": first.get("dtz")}
    return {"category": data.get("category"), "dtm": data.get("dtm"), "dtz": data.get("dtz"), "best": best,
            "source": "tablebase"}
