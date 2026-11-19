# --- FILE: tests/test_puzzles_data.py ---
"""База задач (таск 13.1): качество выборки, перевод тегов в темы реестра, разметка детектором, импорт."""

import collections

import chess
from sqlalchemy import func, select

from src.models.puzzle import Puzzle, PuzzleTheme
from src.services.puzzle_import import (
    ENDGAME,
    GENERATED_SOURCE,
    detected_themes,
    import_rows,
    own_themes,
    read_subset,
    themes_for_row,
    validate_row,
)
from src.services.themes import THEMES

ROWS = list(read_subset())


def test_subset_is_large_and_covers_ratings_evenly():
    assert len(ROWS) >= 20_000
    buckets = collections.Counter((int(r["Rating"]) - 600) // 100 for r in ROWS)
    assert set(buckets) == set(range(20)), sorted(buckets)
    assert min(buckets.values()) >= 800, buckets
    assert len({r["PuzzleId"] for r in ROWS}) == len(ROWS)


def test_every_subset_puzzle_is_legal():
    bad = [r["PuzzleId"] for r in ROWS if not validate_row(r)]
    assert bad == []


def test_every_lichess_marked_theme_has_puzzles():
    tags = collections.Counter(tag for r in ROWS for tag in r["Themes"].split())
    for theme in THEMES:
        if theme.lichess:
            count = sum(tags[tag] for tag in theme.lichess)
            assert count >= 20, (theme.code, count)


def _row(puzzle_id: str, fen: str, moves: str, tags: str = "", rating: int = 1500) -> dict:
    return {"PuzzleId": puzzle_id, "FEN": fen, "Moves": moves, "Rating": str(rating), "RatingDeviation": "75",
            "Popularity": "95", "NbPlays": "1000", "Themes": tags}


# Соперник играет ...Kg8-h8?? (или любой ход), решающий отвечает Nf7+ — вилка конём на короле и ферзе.
KNIGHT_FORK = _row("TESTFK", "r2q2k1/ppp3pp/8/4N3/8/8/PPP2PPP/R2QK2R b KQ - 0 1", "g8h8 e5f7", "fork short")


def test_detector_refines_the_fork_by_piece():
    moves = KNIGHT_FORK["Moves"].split()
    assert "fork_knight" in detected_themes(KNIGHT_FORK["FEN"], moves)
    codes = themes_for_row(KNIGHT_FORK)
    assert codes[0] == "fork" and "fork_knight" in codes


def test_invalid_rows_are_rejected():
    assert not validate_row(_row("X1", "8/8/8/8/8/8/8/8 w - - 0 1", "e2e4 e7e5"))
    assert not validate_row(_row("X2", KNIGHT_FORK["FEN"], "g8h8"))
    assert not validate_row(_row("X3", KNIGHT_FORK["FEN"], "g8h8 e5e9"))
    assert not validate_row(_row("X4", "not a fen", "g8h8 e5f7"))


async def test_import_is_idempotent_and_attaches_themes(db_session):
    sample = [*ROWS[:30], KNIGHT_FORK, _row("BAD", KNIGHT_FORK["FEN"], "a1a1 b2b2")]
    added, skipped = await import_rows(db_session, sample)
    assert (added, skipped) == (31, 1)
    again = await import_rows(db_session, sample)
    assert again == (0, 32)
    assert await db_session.scalar(select(func.count()).select_from(Puzzle)) == 31

    puzzle = await db_session.scalar(select(Puzzle).where(Puzzle.source_id == "TESTFK"))
    assert puzzle is not None and puzzle.rating == 1500 and puzzle.source == "lichess"
    assert set(puzzle.theme_codes) >= {"fork", "fork_knight"}
    by_theme = await db_session.scalar(select(func.count()).select_from(PuzzleTheme).where(PuzzleTheme.theme == "fork_knight"))
    assert by_theme >= 1


# --- своя эндшпильная техника из таблиц (scripts/dev/build_endgame_puzzles.py) ---------------------------------

OWN_ROW = {"PuzzleId": "tb00034kp", "FEN": "4k3/8/6K1/8/4P3/8/8/8 b - - 0 1", "Moves": "e8f8 g6f6", "Rating": "870",
           "RatingDeviation": "80", "Popularity": "90", "NbPlays": "0", "Themes": "endgame pawnEndgame regence:opposition"}
OWN_THEMES = {"opposition", "key_squares", "outflanking", "square_rule", "wrong_bishop"}


def test_own_tag_gives_the_registry_theme_and_unknown_codes_are_ignored():
    assert own_themes(["endgame", "regence:opposition", "regence:no_such_theme"]) == ["opposition"]
    assert themes_for_row(OWN_ROW)[0] == "opposition"


def test_generated_endgame_puzzles_are_legal_small_and_tagged():
    rows = list(read_subset(ENDGAME))
    assert len(rows) >= 150
    assert len({r["PuzzleId"] for r in rows}) == len(rows)
    assert len({r["FEN"] for r in rows}) == len(rows)
    counts = collections.Counter()
    for row in rows:
        assert validate_row(row), row["PuzzleId"]
        themes = own_themes(row["Themes"].split())
        assert len(themes) == 1 and themes[0] in OWN_THEMES, row["PuzzleId"]
        counts[themes[0]] += 1
        board = chess.Board(row["FEN"])
        assert len(board.piece_map()) <= 4, row["PuzzleId"]
        assert 800 <= int(row["Rating"]) <= 2400
    assert set(counts) == OWN_THEMES and min(counts.values()) >= 20, counts


async def test_own_puzzles_are_imported_under_their_own_source(db_session):
    lichess_twin = {**OWN_ROW, "Themes": "endgame pawnEndgame"}
    assert await import_rows(db_session, [OWN_ROW], GENERATED_SOURCE) == (1, 0)
    assert await import_rows(db_session, [OWN_ROW], GENERATED_SOURCE) == (0, 1)
    # Тот же номер в базе lichess — другая задача: источники не пересекаются.
    assert await import_rows(db_session, [lichess_twin]) == (1, 0)
    own = await db_session.scalar(select(Puzzle).where(Puzzle.source == GENERATED_SOURCE))
    themes = set((await db_session.scalars(select(PuzzleTheme.theme).where(PuzzleTheme.puzzle_id == own.id))).all())
    assert "opposition" in themes
