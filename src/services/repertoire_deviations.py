"""
Отклонения от репертуара в сыгранной партии (таск 20.3). Партия проходится по позициям (а не по ходам), поэтому
перестановки ходов распознаются. Для каждого репертуара своего цвета — первое место, где партия ушла из дерева:

* `you_left` — игрок сыграл не свой ход (в репертуаре здесь другой);
* `opponent_new` — соперник сыграл ход, которого в репертуаре нет («добавить ответ?»);
* `end` — партия дошла до конца подготовленной линии;
* `followed` — вся партия прошла по репертуару.
"""

from dataclasses import dataclass

import chess

from src.models.repertoire import Repertoire
from src.services import repertoire as service


@dataclass(frozen=True)
class Deviation:
    kind: str
    ply: int  # полуход партии (с 1), на котором ушли из дерева; для followed — длина партии
    played: str | None  # SAN
    played_uci: str | None
    expected: list[str]
    line: list[str]  # ходы до позиции отклонения
    position: str


def find(repertoire: Repertoire, edges: list[service.Edge], moves: list[chess.Move]) -> Deviation | None:
    """None — партия ни одним ходом не попала в репертуар."""
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
