# --- FILE: src/services/puzzle_import.py ---
"""
Загрузка задач в базу (таск 13.1): строки выборки data/puzzles/lichess_subset.csv.gz → таблицы puzzles и
puzzle_themes. Темы задачи — коды реестра: по тегам базы (``themes_for_lichess_tags``) и по мотивам, которые первый
ход решения создаёт на доске (``themes_for_motif``: вид вилки по фигуре, батарея, перекрытие и т. п.). Задачи, уже
загруженные из того же источника, пропускаются — повторный запуск безопасен.
"""

import csv
import gzip
import pathlib
from collections.abc import Iterable, Iterator

import chess
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.puzzle import Puzzle, PuzzleTheme
from src.services.mentor_service import analyze_move
from src.services.themes import themes_for_lichess_tags, themes_for_motif

SOURCE = "lichess"
SUBSET = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "lichess_subset.csv.gz"
BATCH = 500


def read_subset(path: pathlib.Path = SUBSET) -> Iterator[dict]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as source:
        yield from csv.DictReader(source)


def solver_position(fen: str, moves: list[str]) -> chess.Board:
    """Позиция, которую видит решающий: после хода соперника moves[0]."""
    board = chess.Board(fen)
    board.push_uci(moves[0])
    return board


def detected_themes(fen: str, moves: list[str]) -> list[str]:
    """Темы, которые детектор видит в первом ходе решения (созданные этим ходом мотивы в пользу решающего)."""
    board = solver_position(fen, moves)
    move = chess.Move.from_uci(moves[1])
    facts = analyze_move(board, move)
    result: list[str] = []
    for motif in facts.created:
        attacker = board.copy(stack=False)
        attacker.push(move)
        piece = attacker.piece_at(motif.square)
        for code in themes_for_motif(motif.code, piece.symbol().lower() if piece else None):
            if code not in result:
                result.append(code)
    return result


def themes_for_row(row: dict) -> list[str]:
    moves = row["Moves"].split()
    codes = themes_for_lichess_tags(row["Themes"].split())
    for code in detected_themes(row["FEN"], moves):
        if code not in codes:
            codes.append(code)
    return codes


def validate_row(row: dict) -> bool:
    """Ходы легальны от позиции, решение есть (ход соперника + хотя бы один ход решающего)."""
    moves = row["Moves"].split()
    if len(moves) < 2:
        return False
    try:
        board = chess.Board(row["FEN"])
        for uci in moves:
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                return False
            board.push(move)
    except ValueError:
        return False
    return True


async def import_rows(db: AsyncSession, rows: Iterable[dict]) -> tuple[int, int]:
    """Загружает строки; возвращает (добавлено, пропущено — уже есть или некорректны)."""
    existing = set((await db.execute(select(Puzzle.source_id).where(Puzzle.source == SOURCE))).scalars())
    added = skipped = 0
    pending = 0
    for row in rows:
        if row["PuzzleId"] in existing or not validate_row(row):
            skipped += 1
            continue
        puzzle = Puzzle(
            source=SOURCE, source_id=row["PuzzleId"], fen=row["FEN"], moves=row["Moves"],
            rating=int(row["Rating"]), rating_deviation=int(row["RatingDeviation"]),
            popularity=int(row["Popularity"]), plays=int(row["NbPlays"]), source_tags=row["Themes"][:300],
        )
        puzzle.themes = [PuzzleTheme(theme=code) for code in themes_for_row(row)]
        db.add(puzzle)
        existing.add(row["PuzzleId"])
        added += 1
        pending += 1
        if pending >= BATCH:
            await db.commit()
            pending = 0
    await db.commit()
    return added, skipped
