# --- FILE: src/services/tablebase.py ---
"""
Эндшпильные таблицы (таск 14.4): API таблиц по адресу settings.TABLEBASE_URL — в разработке открытый сервер lichess
(tablebase.lichess.ovh, до 7 фигур), в продакшене — свой сервер таблиц с тем же API (DEPLOY). На сторонний сервер
уходит только позиция (FEN) — никаких данных игрока; клиент представляется общим именем (ATTRIBUTION, «Внешние
сервисы»). Ответ кэшируется в Redis: таблицы не меняются.

Результат с точки зрения стороны, которая ходит: category (win / draw / loss и их «проклятые» варианты по правилу
50 ходов), dtm и dtz — в полуходах (lichess отдаёт их так), лучший ход — первый в списке ответа (lichess сортирует
ходы от лучшего для ходящей стороны).
"""

import json
import logging

import chess
import httpx

from src.core.config import settings
from src.core.errors import DomainError
from src.db import redis as redis_module

logger = logging.getLogger(__name__)

TIMEOUT_S = 4.0
MAX_PIECES = 7
CACHE_TTL_S = 30 * 24 * 3600
USER_AGENT = "michess-endgame-trainer"


async def _fetch(fen: str) -> dict:
    """Запрос к API таблиц (подменяется в тестах)."""
    async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(settings.TABLEBASE_URL, params={"fen": fen})
        response.raise_for_status()
        return response.json()


async def probe(board: chess.Board) -> dict:
    """{category, dtm, dtz, best: {uci, san, category, dtm, dtz} | None} для стороны, которая ходит."""
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
            logger.warning("Tablebase request failed: %s", exc)
            raise DomainError("tablebase_unavailable") from exc
        await redis_module.redis_client.set(key, json.dumps(data), ex=CACHE_TTL_S)
    moves = data.get("moves") or []
    best = None
    if moves:
        first = moves[0]
        move = chess.Move.from_uci(first["uci"])
        if move in board.legal_moves:
            best = {"uci": first["uci"], "san": board.san(move), "category": first.get("category"),
                    "dtm": first.get("dtm"), "dtz": first.get("dtz")}
    return {"category": data.get("category"), "dtm": data.get("dtm"), "dtz": data.get("dtz"), "best": best}
