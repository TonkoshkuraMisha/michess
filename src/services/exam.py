"""
Диагностический экзамен (таск 22.0). Десять тестов по разделам каталога тем — мат (F), двойной удар (A), линейные
удары (B), устранение защиты (C), ловля и особые позиции (D), пешки (E), атака на короля (G), дебютные ловушки (H),
защита (I), эндшпиль (J) — по 10 вопросов от лёгкого к трудному (рейтинг задач 600 → 2400); отдельно — эндшпильный
экзамен на 30 позиций. Вопрос — позиция задачи базы после хода соперника, ответ — один ход (первый ход решения или
любой мат). Подсказок и ответов во время теста нет; итог — оценка силы по разделу максимальным правдоподобием по
формуле Эло и уровень по разрядам. Игровой рейтинг и рейтинг задач не меняются.
"""

import math
import random
from dataclasses import dataclass

import chess
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainValueError
from src.models.puzzle import Puzzle, PuzzleTheme
from src.models.trainer import ExamResult
from src.services.themes import THEMES

EXAM_SECTIONS = ("F", "A", "B", "C", "D", "E", "G", "H", "I", "J")
ENDGAME = "endgame"
QUESTIONS = 10
ENDGAME_QUESTIONS = 30
MIN_RATING, MAX_RATING = 600, 2400
NEAREST = 6
# Уровни по разрядам (ориентир по силе задач).
LEVELS: tuple[tuple[int, str], ...] = ((1000, "novice"), (1200, "fourth"), (1400, "third"), (1600, "second"),
                                       (1800, "first"), (2000, "candidate"), (10_000, "master"))


def themes_of(section: str) -> list[str]:
    code = "J" if section == ENDGAME else section
    return [theme.code for theme in THEMES if theme.section == code]


def targets(count: int) -> list[int]:
    return [round(MIN_RATING + i * (MAX_RATING - MIN_RATING) / (count - 1)) for i in range(count)]


def question_position(puzzle: Puzzle) -> chess.Board:
    board = chess.Board(puzzle.fen)
    board.push_uci(puzzle.moves.split()[0])
    return board


async def build(db: AsyncSession, section: str, rng: random.Random | None = None) -> list[dict]:
    """Вопросы теста: на каждую целевую силу — одна из ближайших по рейтингу задач раздела, без повторов."""
    if section != ENDGAME and section not in EXAM_SECTIONS:
        raise DomainValueError("exam_section_unknown")
    rng = rng or random.Random()
    codes = themes_of(section)
    chosen: list[Puzzle] = []
    for target in targets(ENDGAME_QUESTIONS if section == ENDGAME else QUESTIONS):
        near = (await db.execute(
            select(Puzzle).join(PuzzleTheme, PuzzleTheme.puzzle_id == Puzzle.id)
            .where(PuzzleTheme.theme.in_(codes), Puzzle.id.not_in([p.id for p in chosen] or [0]))
            .order_by(func.abs(Puzzle.rating - target), Puzzle.id).limit(NEAREST)
        )).scalars().unique().all()
        if near:
            chosen.append(rng.choice(near))
    if not chosen:
        raise DomainValueError("exam_section_empty")
    chosen.sort(key=lambda p: p.rating)
    return [{"id": p.id, "fen": question_position(p).fen(), "color": "white" if question_position(p).turn else "black",
             "previous_move": p.moves.split()[0]} for p in chosen]


def is_correct(puzzle: Puzzle, uci: str) -> bool:
    board = question_position(puzzle)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return False
    if move not in board.legal_moves:
        return False
    if uci == puzzle.moves.split()[1]:
        return True
    board.push(move)
    return board.is_checkmate()


def estimate(answers: list[tuple[int, bool]]) -> int:
    """Сила по ответам: максимум правдоподобия P(верно) = 1 / (1 + 10^((r_задачи − r)/400)) с «ничьей» против 1500."""
    def log_likelihood(r: float) -> float:
        total = 0.0
        for rating, ok in [*answers, (1500, True), (1500, False)]:
            p = 1 / (1 + 10 ** ((rating - r) / 400))
            total += math.log(p if ok else 1 - p)
        return total

    return max(range(300, 3001, 10), key=log_likelihood)


def level(rating: int) -> str:
    return next(code for limit, code in LEVELS if rating < limit)


@dataclass
class Graded:
    section: str
    correct: int
    total: int
    estimate: int
    review: list[dict]


async def grade(db: AsyncSession, user_id: int, section: str, answers: list[tuple[int, str]]) -> Graded:
    if section != ENDGAME and section not in EXAM_SECTIONS:
        raise DomainValueError("exam_section_unknown")
    codes = set(themes_of(section))
    ids = [pid for pid, _ in answers]
    puzzles = {p.id: p for p in (await db.execute(select(Puzzle).where(Puzzle.id.in_(ids)))).scalars().all()}
    themes: dict[int, set[str]] = {}
    for pid, theme in (await db.execute(select(PuzzleTheme.puzzle_id, PuzzleTheme.theme)
                                        .where(PuzzleTheme.puzzle_id.in_(ids)))).tuples():
        themes.setdefault(pid, set()).add(theme)
    review, scored = [], []
    for pid, uci in answers:
        puzzle = puzzles.get(pid)
        if puzzle is None or not themes.get(pid, set()) & codes:
            raise DomainValueError("exam_question_unknown")
        ok = is_correct(puzzle, uci)
        scored.append((puzzle.rating, ok))
        board = question_position(puzzle)
        solution = puzzle.moves.split()[1]
        review.append({"id": pid, "answer": uci, "correct": ok, "solution": solution,
                       "solution_san": board.san(chess.Move.from_uci(solution)), "rating": puzzle.rating})
    result = Graded(section, sum(ok for _, ok in scored), len(scored), estimate(scored), review)
    db.add(ExamResult(user_id=user_id, section=section, correct=result.correct, total=result.total,
                      estimate=result.estimate))
    return result


async def latest(db: AsyncSession, user_id: int) -> dict:
    """Последний результат по каждому тесту и общий уровень — среднее оценок пройденных разделов (без эндшпильного)."""
    rows = (await db.execute(
        select(ExamResult).where(ExamResult.user_id == user_id).order_by(ExamResult.created_at, ExamResult.id)
    )).scalars().all()
    last = {row.section: row for row in rows}
    sections = {key: {"correct": r.correct, "total": r.total, "estimate": r.estimate, "level": level(r.estimate),
                      "at": r.created_at.isoformat() if r.created_at else None} for key, r in last.items()}
    diagnostic = [r.estimate for key, r in last.items() if key in EXAM_SECTIONS]
    overall = round(sum(diagnostic) / len(diagnostic)) if diagnostic else None
    return {"sections": sections, "overall": overall, "level": level(overall) if overall else None,
            "passed": len(diagnostic), "of": len(EXAM_SECTIONS)}
