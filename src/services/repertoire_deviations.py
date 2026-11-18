"""
Отклонения от репертуара в сыгранной партии (таск 20.3). Партия проходится по позициям (а не по ходам), поэтому
перестановки ходов распознаются. Для каждого репертуара своего цвета — первое место, где партия ушла из дерева:

* `you_left` — игрок сыграл не свой ход (в репертуаре здесь другой);
* `opponent_new` — соперник сыграл ход, которого в репертуаре нет («добавить ответ?»);
* `end` — партия дошла до конца подготовленной линии;
* `followed` — вся партия прошла по репертуару.

Ничего не хранит: дерево репертуара строит src/services/repertoire.build_tree из repertoire_moves, ходы партии —
главная линия PGN законченной партии (game_moves). Сверку всех репертуаров игрока делает for_game; её отдают маршрут
GET /repertoires/game/{id}/deviations (src/api/repertoire.py) и карточки после партии (src/services/coach_cards.py).
"""

import io
from dataclasses import dataclass

import chess
import chess.pgn
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.repertoire import Repertoire
from src.services import repertoire as service


@dataclass(frozen=True)
class Deviation:
    """Место, где партия разошлась с репертуаром (или итог «прошла целиком»)."""

    kind: str
    ply: int  # полуход партии (с 1), на котором ушли из дерева; для followed — длина партии
    played: str | None  # SAN
    played_uci: str | None
    expected: list[str]  # ходы репертуара из этой позиции (SAN); пусто для end и followed
    line: list[str]  # ходы до позиции отклонения
    position: str  # ключ позиции отклонения (EPD, repertoire.position_key)


def find(repertoire: Repertoire, edges: list[service.Edge], moves: list[chess.Move]) -> Deviation | None:
    """
    Первое расхождение партии с репертуаром. None — сравнивать не с чем: в партии нет ходов или в репертуаре нет
    ходов из начальной позиции. Если же первый ход партии не совпал с репертуаром, это отклонение на первом
    полуходе (you_left или opponent_new), а не None.
    """
    by_position: dict[str, list[service.Edge]] = {}
    for edge in edges:
        by_position.setdefault(edge.position, []).append(edge)
    side = chess.WHITE if repertoire.color == "white" else chess.BLACK
    board = chess.Board()
    for index, move in enumerate(moves):
        key = service.position_key(board)
        options = by_position.get(key, [])
        line = [m.uci() for m in moves[:index]]
        if not options:
            return Deviation("end", index + 1, None, None, [], line, key) if index else None
        if move.uci() not in {e.uci for e in options}:
            kind = "you_left" if board.turn == side else "opponent_new"
            return Deviation(kind, index + 1, board.san(move), move.uci(), [e.san for e in options], line, key)
        board.push(move)
    return Deviation("followed", len(moves), None, None, [], [m.uci() for m in moves],
                     service.position_key(board)) \
        if moves else None


def game_moves(pgn: str | None) -> list[chess.Move]:
    """Главная линия партии из начальной позиции; партии с особой расстановкой не сверяются (пустой список)."""
    parsed = chess.pgn.read_game(io.StringIO(pgn or ""))
    if parsed is None or parsed.board().fen() != chess.STARTING_FEN:
        return []
    return list(parsed.mainline_moves())


async def for_game(db: AsyncSession, game: Game, user_id: int) -> dict:
    """
    Где партия ушла из каждого репертуара игрока её цвета: {color, results}. results — по одному на репертуар
    (repertoire_id, name, starter, kind, ply, played, played_uci, expected, line, position), самые поздние
    отклонения первыми. Проверку «своя законченная партия» делает вызывающий.
    """
    color = "white" if game.white_player_id == user_id else "black"
    moves = game_moves(game.pgn)
    repertoires = (await db.execute(
        select(Repertoire).where(Repertoire.user_id == user_id, Repertoire.color == color).order_by(Repertoire.id)
    )).scalars().all()
    results: list[dict] = []
    for repertoire in repertoires:
        edges = service.build_tree(repertoire.color, await service.load_moves(db, repertoire.id))
        found = find(repertoire, edges, moves)
        if found is None:
            continue
        results.append({"repertoire_id": repertoire.id, "name": repertoire.name, "starter": repertoire.starter,
                        "kind": found.kind, "ply": found.ply, "played": found.played, "played_uci": found.played_uci,
                        "expected": found.expected, "line": found.line, "position": found.position})
    results.sort(key=lambda r: -int(r["ply"]))
    return {"color": color, "results": results}
