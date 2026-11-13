# --- FILE: src/services/puzzle_import.py ---
"""
Загрузка задач в базу (таск 13.1): строки выборки data/puzzles/lichess_subset.csv.gz → таблицы puzzles и
puzzle_themes. Темы задачи — коды реестра: по тегам базы (``themes_for_lichess_tags``) и по мотивам, которые первый
ход решения создаёт на доске (``themes_for_motif``: вид вилки по фигуре, батарея, перекрытие и т. п.). Задачи, уже
загруженные из того же источника, пропускаются — повторный запуск безопасен. Именные матовые конструкции, для
которых в базе нет тегов, распознаются по финальной позиции решения (src/services/mate_patterns.py).

Разметка версионируется (TAG_VERSION): когда меняются реестр, детектор или классификатор матов, версия растёт, и
импорт переразмечает уже загруженные задачи (``retag_outdated``) — без повторной загрузки.
"""

import csv
import gzip
import pathlib
from collections.abc import Iterable, Iterator

import chess
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.puzzle import Puzzle, PuzzleTheme
from src.services.mate_patterns import patterns_for_solution
from src.services.mentor_service import analyze_move
from src.services.themes import themes_for_lichess_tags, themes_for_motif

SOURCE = "lichess"
TAG_VERSION = 2  # 2: ступень — по уточнённой формуле (приём с продолжением — ступень 1)
SUBSET = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "lichess_subset.csv.gz"
BATCH = 500


def read_subset(path: pathlib.Path = SUBSET) -> Iterator[dict]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as source:
        yield from csv.DictReader(source)


def stage_for(rating: int, moves: list[str]) -> int:
    """
    Ступень задачи (таск 13.4): 1 — знакомство (приём в чистом виде), 2 — закрепление, 3 — в сочетании, 4 — мастер.
    По рейтингу и длине решения. Приём «в чистом виде» — это ход и его естественное продолжение (вилка и взятие
    фигуры), то есть до двух ходов решающего; длина поднимает ступень с трёх ходов. ``moves`` — как в базе: первый
    ход соперника, дальше чередование. Та же формула — в миграции c5e7a9b1d3f6.
    """
    plies = len(moves)
    if rating >= 2000 or plies >= 10:
        return 4
    if rating >= 1600 or plies >= 8:
        return 3
    if rating >= 1200 or plies >= 6:
        return 2
    return 1


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
    for code in [*detected_themes(row["FEN"], moves), *patterns_for_solution(row["FEN"], moves)]:
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


async def retag_outdated(db: AsyncSession) -> int:
    """Переразметить задачи с версией разметки ниже TAG_VERSION (темы и ступень). Возвращает число задач."""
    from sqlalchemy import delete

    from src.services.puzzles import reset_stage_counts

    count = 0
    while True:
        batch = (await db.execute(
            select(Puzzle).where(Puzzle.tag_version < TAG_VERSION).order_by(Puzzle.id).limit(BATCH)
        )).scalars().all()
        if not batch:
            break
        ids = [p.id for p in batch]
        await db.execute(delete(PuzzleTheme).where(PuzzleTheme.puzzle_id.in_(ids)))
        for puzzle in batch:
            row = {"FEN": puzzle.fen, "Moves": puzzle.moves, "Themes": puzzle.source_tags}
            db.add_all(PuzzleTheme(puzzle_id=puzzle.id, theme=code) for code in themes_for_row(row))
            puzzle.stage = stage_for(puzzle.rating, puzzle.moves.split())
            puzzle.tag_version = TAG_VERSION
        await db.commit()
        db.expire_all()
        count += len(batch)
    reset_stage_counts()
    return count


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
            stage=stage_for(int(row["Rating"]), row["Moves"].split()), tag_version=TAG_VERSION,
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
    from src.services.puzzles import reset_stage_counts

    reset_stage_counts()
    return added, skipped
