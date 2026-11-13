# --- FILE: tests/test_mate_patterns.py ---
"""Именные матовые конструкции (таск 13.4): по одному характерному примеру на конструкцию и отрицательные случаи."""

import chess
import pytest

from src.services.mate_patterns import mate_patterns, patterns_for_solution
from src.services.puzzle_import import TAG_VERSION, import_rows, retag_outdated


def _after(fen: str, uci: str) -> list[str]:
    board = chess.Board(fen)
    move = chess.Move.from_uci(uci)
    # push() легальность не проверяет — тестовая позиция с невозможным ходом проверяла бы не то.
    assert move in board.legal_moves, (fen, uci)
    board.push(move)
    return mate_patterns(board, move)


@pytest.mark.parametrize("fen, uci, pattern", [
    # Ферзь вплотную, защищён конём.
    ("6k1/5ppp/8/6N1/8/8/5PPP/3Q2K1 w - - 0 1", "d1h5", None),
    ("5rk1/5pp1/7p/6N1/8/3Q4/5PPP/6K1 w - - 0 1", "d3h7", "queen_kiss_mate"),
    # Блэкберн: Сh7# при слоне f6 и коне g5 (позиция из базы задач).
    ("r4rk1/1b1q1p2/p3pB2/1p4Np/3PBb2/P7/1P3PPP/2R3K1 w - - 0 25", "e4h7", "blackburne_mate"),
    # Эполетный: Фb6#, по бокам короля b8 — ладьи a8 и c8.
    ("rkrq4/2p5/np4p1/p7/5B2/4Q3/1P3PPP/2R3K1 w - - 4 37", "e3b6", "epaulette_mate"),
    # Дамиано: Фh7#, ферзь на краю защищён пешкой g6.
    ("5rk1/5p2/6P1/8/8/8/5PP1/6KQ w - - 0 1", "h1h7", "damiano_mate"),
    # Лолли: Фg7#, защищён пешкой f6.
    ("5rk1/5p1p/5P2/8/8/8/6PP/4Q1K1 w - - 0 1", "e1g3", None),
    ("5rk1/5p1p/5PQ1/8/8/8/6PP/6K1 w - - 0 1", "g6g7", "lolli_mate"),
    # Греко: Кh8 в углу, Лh-вертикаль, слон c4 отнимает g8.
    ("7k/6p1/8/8/2B5/8/6PP/4R1K1 w - - 0 1", "e1e8", None),
    ("7k/6p1/8/8/2B5/8/6P1/7R w - - 0 1", "h1h7", None),
    ("7k/6p1/8/8/2B5/7R/6PP/6K1 w - - 0 1", "h3h7", None),
])
def test_patterns(fen, uci, pattern):
    found = _after(fen, uci)
    if pattern is None:
        assert not (set(found) & {"blackburne_mate", "epaulette_mate", "damiano_mate", "lolli_mate"})
    else:
        assert pattern in found, found


def test_greco_and_corridor_from_the_puzzle_base():
    greco = patterns_for_solution("1r3rk1/2R1Rppp/1p6/pq6/2BQ4/P5Pb/1P3P1P/6K1 b - - 3 22",
                                  ["b8d8", "e7f7", "d8d4", "f7g7", "g8h8", "g7h7"])
    assert "greco_mate" in greco
    corridor = patterns_for_solution("2r3k1/5ppp/4p3/3pQ1PP/3P4/2Pb4/pPq5/K2R2R1 w - - 1 32",
                                     ["h5h6", "c2b1", "d1b1", "a2b1q", "g1b1", "c8a8"])
    assert "corridor_mate" in corridor
    opera = patterns_for_solution("6k1/p5p1/1p3r1p/1N1pR3/PP6/6Pb/5B1Q/3q2K1 w - - 1 35",
                                  ["e5e1", "d1e1", "f2e1", "f6f1"])
    assert "opera_mate" in opera


def test_no_mate_no_patterns():
    assert patterns_for_solution(chess.STARTING_FEN, ["e2e4"]) == []
    assert patterns_for_solution(chess.STARTING_FEN, []) == []


async def test_retag_updates_old_puzzles(db_session):
    from sqlalchemy import select

    from src.models.puzzle import Puzzle

    row = {"PuzzleId": "BLK", "FEN": "r4rk1/1b1q1p2/p3pBp1/1p4NQ/3PBb2/P7/1P3PPP/2R3K1 b - - 0 24",
           "Moves": "g6h5 e4h7", "Rating": "1700", "RatingDeviation": "75", "Popularity": "95", "NbPlays": "900",
           "Themes": "mateIn1 kingsideAttack"}
    await import_rows(db_session, [row])
    puzzle = await db_session.scalar(select(Puzzle).where(Puzzle.source_id == "BLK"))
    assert "blackburne_mate" in puzzle.theme_codes and puzzle.tag_version == TAG_VERSION
    # Старая разметка: тем меньше, версия 0 — переразметка возвращает всё.
    puzzle.tag_version = 0
    puzzle.themes = [t for t in puzzle.themes if t.theme == "mate_in_1"]
    await db_session.commit()
    assert await retag_outdated(db_session) == 1
    db_session.expire_all()
    puzzle = await db_session.scalar(select(Puzzle).where(Puzzle.source_id == "BLK"))
    assert {"mate_in_1", "kingside_attack", "blackburne_mate"} <= set(puzzle.theme_codes)
    assert await retag_outdated(db_session) == 0
