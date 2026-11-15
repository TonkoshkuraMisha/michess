"""
Дебютный репертуар (таск 20.1): линии из справочника, из PGN и из своих партий складываются в граф позиций
(src/models/repertoire.py). Клиент получает рёбра с SAN и ключом позиции после хода и ходит по дереву, не вычисляя
ключи сам; новые ходы присылает линией UCI из начальной позиции.
"""

import io
from collections import deque
from dataclasses import dataclass

import chess
import chess.pgn
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainValueError
from src.models.repertoire import Repertoire, RepertoireMove
from src.services.repertoire_starters import Starter

MAX_REPERTOIRES = 20
MAX_MOVES = 2000
MAX_LINE_PLIES = 40
MAX_PGN_CHARS = 100_000
MAX_PGN_GAMES = 50
MAX_COMMENT = 300
ROOT = chess.Board().epd()


def position_key(board: chess.Board) -> str:
    return board.epd()


@dataclass(frozen=True)
class Edge:
    position: str
    uci: str
    san: str
    child: str
    comment: str
    mine: bool


def parse_line(moves_uci: list[str]) -> list[tuple[str, str]]:
    """Линия UCI из начальной позиции → пары (позиция, ход); нелегальный ход — ошибка с этим ходом."""
    board = chess.Board()
    pairs = []
    for uci in moves_uci[:MAX_LINE_PLIES]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise DomainValueError("illegal_move", move=uci[:10]) from None
        if move not in board.legal_moves:
            raise DomainValueError("illegal_move", move=uci)
        pairs.append((position_key(board), move.uci()))
        board.push(move)
    return pairs


def san_line_to_uci(line: str) -> list[str]:
    board = chess.Board()
    moves = []
    for san in line.split():
        move = board.parse_san(san)
        moves.append(move.uci())
        board.push(move)
    return moves


def starter_lines(starter: Starter) -> list[list[str]]:
    return [san_line_to_uci(line) for line in starter.lines]


def pgn_lines(text: str) -> list[list[str]]:
    """Все линии (главная и варианты) всех партий текста PGN; партии не из начальной позиции пропускаются."""
    if len(text) > MAX_PGN_CHARS:
        raise DomainValueError("repertoire_bad_pgn")
    handle = io.StringIO(text)
    lines: list[list[str]] = []
    for _ in range(MAX_PGN_GAMES):
        game = chess.pgn.read_game(handle)
        if game is None:
            break
        if game.errors or game.board().epd() != ROOT:
            continue
        stack: list[tuple[chess.pgn.GameNode, list[str]]] = [(game, [])]
        while stack:
            node, path = stack.pop()
            if not node.variations or len(path) >= MAX_LINE_PLIES:
                if path:
                    lines.append(path)
                continue
            for child in node.variations:
                stack.append((child, [*path, child.move.uci()]))
    if not lines:
        raise DomainValueError("repertoire_bad_pgn")
    return lines


def build_tree(color: str, rows: list[RepertoireMove]) -> list[Edge]:
    """Рёбра, достижимые из начальной позиции, в порядке обхода в ширину (короткие линии — первыми)."""
    by_position: dict[str, list[RepertoireMove]] = {}
    for row in sorted(rows, key=lambda r: r.id):
        by_position.setdefault(row.position, []).append(row)
    side = chess.WHITE if color == "white" else chess.BLACK
    edges: list[Edge] = []
    seen = {ROOT}
    queue = deque([chess.Board()])
    while queue:
        board = queue.popleft()
        key = position_key(board)
        for row in by_position.get(key, []):
            move = chess.Move.from_uci(row.move_uci)
            if move not in board.legal_moves:
                continue
            san = board.san(move)
            child = board.copy(stack=False)
            child.push(move)
            child_key = position_key(child)
            edges.append(Edge(key, row.move_uci, san, child_key, row.comment, board.turn == side))
            if child_key not in seen:
                seen.add(child_key)
                queue.append(child)
    return edges


async def load_moves(db: AsyncSession, repertoire_id: int) -> list[RepertoireMove]:
    return list((await db.execute(
        select(RepertoireMove).where(RepertoireMove.repertoire_id == repertoire_id)
    )).scalars().all())


async def count_moves(db: AsyncSession, repertoire_id: int) -> int:
    return await db.scalar(
        select(func.count()).select_from(RepertoireMove).where(RepertoireMove.repertoire_id == repertoire_id)
    ) or 0


async def add_lines(db: AsyncSession, repertoire: Repertoire, lines: list[list[str]]) -> int:
    """Добавляет ходы линий, которых ещё нет; сверх MAX_MOVES — ошибка, ничего не добавляется."""
    existing = {(row.position, row.move_uci) for row in await load_moves(db, repertoire.id)}
    new: dict[tuple[str, str], None] = {}
    for line in lines:
        for pair in parse_line(line):
            if pair not in existing:
                new[pair] = None
    if len(existing) + len(new) > MAX_MOVES:
        raise DomainValueError("repertoire_too_large", limit=MAX_MOVES)
    db.add_all(RepertoireMove(repertoire_id=repertoire.id, position=position, move_uci=uci)
               for position, uci in new)
    return len(new)


async def remove_move(db: AsyncSession, repertoire: Repertoire, position: str, uci: str) -> int:
    """Убирает ход и всё, что после него стало недостижимо из начальной позиции; возвращает число удалённых ходов."""
    rows = await load_moves(db, repertoire.id)
    target = next((row for row in rows if row.position == position and row.move_uci == uci), None)
    if target is None:
        raise DomainValueError("repertoire_move_not_found")
    rest = [row for row in rows if row is not target]
    reachable = {(edge.position, edge.uci) for edge in build_tree(repertoire.color, rest)}
    doomed = [target.id, *(row.id for row in rest if (row.position, row.move_uci) not in reachable)]
    await db.execute(delete(RepertoireMove).where(RepertoireMove.id.in_(doomed)))
    return len(doomed)
