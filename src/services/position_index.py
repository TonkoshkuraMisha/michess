# --- FILE: src/services/position_index.py ---
"""
Индекс позиций (таск 16.1). Найти позицию перебором PGN в запросе невозможно — поэтому для каждой законченной
партии первые MAX_PLIES полуходов раскладываются в таблицы: position_stats (позиция + ход → победы белых / ничьи /
победы чёрных) и position_games (позиция → партии). Партия индексируется один раз (games.positions_indexed): архив —
скриптом scripts/build_position_index.py, новые партии — задачей Celery при завершении (src/worker/tasks.py).

Не индексируются: незаконченные и без результата, симуляции турниров (боты между собой исказили бы статистику),
партии из своей позиции (заголовок FEN).

Позиция в таблицах — 64-битный хэш Zobrist (расстановка, очередь хода, рокировки, взятие на проходе), а не FEN:
разные позиции изредка могут совпасть по хэшу, поэтому читатель индекса проверяет легальность хода
(src/services/opening_explorer.py). Читают индекс справочник дебютов и репертуар.

Партии библиотеки (8б) раскладываются отдельно — в position_library_games, только «партия ↔ позиция», без
статистики: это примеры под позицией в справочнике, а многие из них есть и в архиве (повтор посчитался бы дважды).
Новые партии библиотеки индексирует импорт (src/services/library.py), уже загруженные — scripts/build_position_index.py
--library. Партия из своей позиции (start_fen) не индексируется: её позиции не встречаются в дебюте.
"""

import io
from collections import Counter
from dataclasses import dataclass

import chess
import chess.pgn
import chess.polyglot
from sqlalchemy import select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game, GameStatus
from src.models.library import LibraryGame
from src.models.position import PositionGame, PositionLibraryGame, PositionStat

MAX_PLIES = 30  # сколько первых полуходов партии попадает в индекс (15 ходов): глубже статистики нет
# Результат партии → прибавка к счётчикам (победы белых, ничьи, победы чёрных). Другой результат («*») — не в индекс.
RESULTS = {"1-0": (1, 0, 0), "1/2-1/2": (0, 1, 0), "0-1": (0, 0, 1)}


def position_key(board: chess.Board) -> int:
    """Хэш Zobrist позиции со знаком (BIGINT в Postgres — со знаком)."""
    value = chess.polyglot.zobrist_hash(board)
    return value - (1 << 64) if value >= 1 << 63 else value


def _insert(db: AsyncSession, model):
    """INSERT с поддержкой ON CONFLICT для диалекта сессии: PostgreSQL в работе, SQLite в тестах."""
    return (postgresql.insert(model) if db.bind.dialect.name == "postgresql" else sqlite.insert(model))


def plies_of(pgn: str) -> tuple[str, list[tuple[int, str, int]]] | None:
    """(результат, [(хэш позиции до хода, ход, номер полухода)]) или None, если партию не индексируем."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or "FEN" in game.headers:
        return None
    result = game.headers.get("Result")
    if result not in RESULTS:
        return None
    board = game.board()
    plies = []
    for ply, move in enumerate(game.mainline_moves()):
        if ply >= MAX_PLIES:
            break
        plies.append((position_key(board), move.uci(), ply))
        board.push(move)
    return result, plies


async def index_game(db: AsyncSession, game: Game) -> bool:
    """
    Добавляет партию в индекс (без commit). True — добавлена; повторный вызов ничего не меняет. Законченная партия,
    которую индексировать нельзя (своя позиция, нет результата, нет ходов), всё равно помечается
    games.positions_indexed, чтобы к ней не возвращаться. В position_games записывается первый полуход, на котором
    позиция встретилась в партии.
    """
    if game.positions_indexed or game.status != GameStatus.COMPLETED or game.is_simulation or not game.pgn:
        return False
    parsed = plies_of(game.pgn)
    game.positions_indexed = True
    if parsed is None or not parsed[1]:
        return False
    result, plies = parsed
    white, draw, black = RESULTS[result]
    # Ход из позиции считается один раз на партию, даже если позиция повторилась.
    moves = Counter((key, uci) for key, uci, _ in plies)
    stats = _insert(db, PositionStat).values([
        {"position_hash": key, "move_uci": uci, "white_wins": white, "draws": draw, "black_wins": black}
        for key, uci in moves
    ])
    excluded = stats.excluded
    await db.execute(stats.on_conflict_do_update(
        index_elements=["position_hash", "move_uci"],
        set_={"white_wins": PositionStat.white_wins + excluded.white_wins, "draws": PositionStat.draws + excluded.draws,
              "black_wins": PositionStat.black_wins + excluded.black_wins},
    ))
    first_ply: dict[int, int] = {}
    for key, _, ply in plies:
        first_ply.setdefault(key, ply)
    await db.execute(_insert(db, PositionGame).values([
        {"position_hash": key, "game_id": game.id, "ply": ply} for key, ply in first_ply.items()
    ]).on_conflict_do_nothing(index_elements=["position_hash", "game_id"]))
    return True


@dataclass(frozen=True)
class MoveStat:
    """Статистика хода из позиции: победы белых, ничьи и победы чёрных; games — всего партий."""
    move_uci: str
    white_wins: int
    draws: int
    black_wins: int

    @property
    def games(self) -> int:
        return self.white_wins + self.draws + self.black_wins


async def moves_from(db: AsyncSession, board: chess.Board) -> list[MoveStat]:
    """Ходы из позиции по индексу — от самого частого."""
    rows = (await db.execute(
        select(PositionStat).where(PositionStat.position_hash == position_key(board))
    )).scalars().all()
    stats = [MoveStat(r.move_uci, r.white_wins, r.draws, r.black_wins) for r in rows]
    return sorted(stats, key=lambda s: (-s.games, s.move_uci))


async def games_through(db: AsyncSession, board: chess.Board, limit: int = 20) -> list[int]:
    """id партий, проходивших через позицию (новые id — первыми)."""
    rows = await db.execute(
        select(PositionGame.game_id).where(PositionGame.position_hash == position_key(board))
        .order_by(PositionGame.game_id.desc()).limit(limit)
    )
    return list(rows.scalars())


async def index_by_id(db: AsyncSession, game_id: int) -> bool:
    """Индексирует партию по номеру и делает commit — для фоновой задачи после завершения партии."""
    game = await db.get(Game, game_id)
    if game is None:
        return False
    added = await index_game(db, game)
    await db.commit()
    return added


def library_plies(moves: str) -> dict[int, int]:
    """
    {хэш позиции: первый полуход} для первых MAX_PLIES полуходов партии библиотеки (ходы UCI через пробел, от
    начальной позиции). Нелегальный ход обрывает разбор: позиции до него остаются.
    """
    board = chess.Board()
    first_ply: dict[int, int] = {}
    for ply, uci in enumerate(moves.split()[:MAX_PLIES]):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        first_ply.setdefault(position_key(board), ply)
        board.push(move)
    return first_ply


async def index_library_game(db: AsyncSession, game: LibraryGame) -> bool:
    """
    Добавляет партию библиотеки в position_library_games (без commit). True — добавлена; повторный вызов ничего не
    меняет. Партия из своей позиции или без ходов только помечается positions_indexed.
    """
    if game.positions_indexed:
        return False
    game.positions_indexed = True
    if game.start_fen or not game.moves:
        return False
    first_ply = library_plies(game.moves)
    if not first_ply:
        return False
    await db.execute(_insert(db, PositionLibraryGame).values([
        {"position_hash": key, "library_game_id": game.id, "ply": ply} for key, ply in first_ply.items()
    ]).on_conflict_do_nothing(index_elements=["position_hash", "library_game_id"]))
    return True
