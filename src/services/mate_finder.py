# --- FILE: src/services/mate_finder.py ---
"""
«Найти мат» (таск 16.4): игрок задаёт глубину (до MAX_MOVES ходов), движок ищет мат под лимитом времени и возвращает
линию. Движок — только через пул (src/services/engine_pool.py); поиск — в потоке, чтобы не держать цикл событий.

Маршрут — src/api/analysis.py (закрыт правилом честной игры: во время своей партии недоступен). Ничего не хранит.
"""

import asyncio

import chess
import chess.engine

from src.services.bots.base import resolve_stockfish_path
from src.services.engine_pool import EngineUnavailableError, get_engine_pool
from src.services.game_engine import board_from_start_fen

MAX_MOVES = 5  # самая большая глубина, которую можно запросить (проверяет схема запроса в src/api/analysis.py)
TIME_LIMIT_S = 3.0  # предел одного поиска: за это время мат в MAX_MOVES может и не найтись — тогда ответ «не найден»


def _search(board: chess.Board, moves: int) -> tuple[int | None, list[chess.Move]]:
    """(мат в N ходов с точки зрения стороны, которая ходит, или None; главная линия)."""
    path = resolve_stockfish_path()
    if not path:
        raise EngineUnavailableError("stockfish not found")
    with get_engine_pool(path).acquire() as engine:
        info = engine.analyse(board, chess.engine.Limit(mate=moves, time=TIME_LIMIT_S))
    if isinstance(info, list):
        info = info[0]
    mate = info["score"].relative.mate()
    return mate, list(info.get("pv") or [])


async def find_mate(fen: str, moves: int) -> dict:
    """
    Ищет мат не длиннее moves ходов: найден ли он, за сколько ходов и сама линия (в записи UCI и SAN). Поиск идёт в
    отдельном потоке под лимитом времени. «Не найден» — также когда матует соперник (mate <= 0), мат длиннее
    запрошенного или партия в позиции уже окончена. Линия обрезается до матующего хода: mate ходов стороны и
    mate - 1 ответов соперника.
    """
    board = board_from_start_fen(fen)  # InvalidStartPositionError — невозможная позиция
    if board.is_game_over():
        return {"found": False, "mate_in": None, "line": [], "san": []}
    mate, pv = await asyncio.to_thread(_search, board, moves)
    if mate is None or mate <= 0 or mate > moves:
        return {"found": False, "mate_in": None, "line": [], "san": []}
    line = pv[: mate * 2 - 1]
    san = []
    probe = board.copy()
    for move in line:
        san.append(probe.san(move))
        probe.push(move)
    return {"found": True, "mate_in": mate, "line": [m.uci() for m in line], "san": san}
