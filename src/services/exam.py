"""
Диагностический экзамен (таск 22.0). Десять тестов по разделам каталога тем — мат (F), двойной удар (A), линейные
удары (B), устранение защиты (C), ловля и особые позиции (D), пешки (E), атака на короля (G), дебютные ловушки (H),
защита (I), эндшпиль (J) — по 10 вопросов от лёгкого к трудному (рейтинг задач 600 → 2400); отдельно — эндшпильный
экзамен на 30 позиций. Вопрос — позиция задачи базы после хода соперника. Решение доигрывается до конца: после верного
хода соперник отвечает ходом из решения, и игрок продолжает — до мата или последнего хода комбинации; за каждый верный
ход — очко. Ошибка заканчивает позицию (очки за уже найденные ходы остаются); любой мат засчитывается как полное
решение. Подсказок нет. Итог — оценка силы по разделу максимальным правдоподобием по формуле Эло (доля найденных ходов
решения — как дробный результат «партии» с задачей) и уровень по разрядам. Игровой рейтинг и рейтинг задач не
меняются.

Экзамены уровней Большого курса (level0 … level5, таск 27.12) идут тем же протоколом, но позиции — из фиксированного
набора src/services/level_exam.py.

Откуда данные: вопросы — таблицы puzzles и puzzle_themes (поле moves задачи: первый ход — соперника, дальше решение);
разделы и их темы — реестр src/services/themes.py; результаты — таблица exam_results (каждое прохождение — новая
строка, в итогах берётся последняя по разделу). Движок не используется. Маршруты — src/api/exam.py.
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
from src.services import level_exam
from src.services.themes import THEMES

# Разделы каталога тем (src/services/themes.py), по которым есть диагностический тест.
EXAM_SECTIONS = ("F", "A", "B", "C", "D", "E", "G", "H", "I", "J")
# Отдельный эндшпильный экзамен: те же темы раздела J, но ENDGAME_QUESTIONS позиций вместо QUESTIONS.
ENDGAME = "endgame"
QUESTIONS = 10
ENDGAME_QUESTIONS = 30
# Рейтинг задач первого и последнего вопроса теста; остальные — равномерно между ними.
MIN_RATING, MAX_RATING = 600, 2400
# Вопрос выбирается случайно из стольких ближайших по рейтингу задач раздела — чтобы тесты не повторялись.
NEAREST = 6
# Уровни по разрядам (ориентир по силе задач): (верхняя граница оценки, код уровня) — берётся первый, чья граница
# выше оценки.
LEVELS: tuple[tuple[int, str], ...] = ((1000, "novice"), (1200, "fourth"), (1400, "third"), (1600, "second"),
                                       (1800, "first"), (2000, "candidate"), (10_000, "master"))


def themes_of(section: str) -> list[str]:
    """Коды тем раздела каталога; у эндшпильного экзамена — темы раздела J."""
    code = "J" if section == ENDGAME else section
    return [theme.code for theme in THEMES if theme.section == code]


def targets(count: int) -> list[int]:
    """Целевые рейтинги вопросов: count значений равномерно от MIN_RATING до MAX_RATING."""
    return [round(MIN_RATING + i * (MAX_RATING - MIN_RATING) / (count - 1)) for i in range(count)]


def question_position(puzzle: Puzzle) -> chess.Board:
    """Позиция вопроса: позиция задачи после первого хода из moves (хода соперника); ходит решающий."""
    board = chess.Board(puzzle.fen)
    board.push_uci(puzzle.moves.split()[0])
    return board


async def build(db: AsyncSession, section: str, rng: random.Random | None = None) -> list[dict]:
    """
    Вопросы теста: на каждую целевую силу — одна из ближайших по рейтингу задач раздела, без повторов. Вопросы идут
    по возрастанию рейтинга; клиенту отдаются номер задачи, позиция, цвет решающего и предыдущий ход соперника —
    без решения. Экзамен уровня курса отдаёт фиксированный набор (level_exam.questions). Неизвестный раздел —
    exam_section_unknown, в разделе нет задач — exam_section_empty.
    """
    if level_exam.is_level_section(section):
        return level_exam.questions(section)
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


@dataclass(frozen=True)
class Progress:
    """Как далеко игрок прошёл решение: верных ходов из скольких, доиграно ли, ошибся ли, чем ответит соперник."""
    correct: int
    total: int
    solved: bool
    failed: bool
    reply: str | None = None

    @property
    def share(self) -> float:
        return self.correct / self.total if self.total else 0.0


def play(start: chess.Board, line: list[str], played: list[str]) -> Progress:
    """
    Сверяет ходы игрока с решением. line — решение от позиции вопроса: ход игрока, ответ соперника, ход игрока…
    Ход, дающий мат, — полное решение, даже если в базе другой. Первый неверный ход заканчивает позицию.
    """
    board = start.copy(stack=False)
    total = (len(line) + 1) // 2
    correct = 0
    for index, uci in enumerate(played[:total]):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return Progress(correct, total, False, True)
        if move not in board.legal_moves:
            return Progress(correct, total, False, True)
        board.push(move)
        if uci != line[2 * index]:
            if board.is_checkmate():
                return Progress(total, total, True, False)
            return Progress(correct, total, False, True)
        correct += 1
        if 2 * index + 1 >= len(line):
            return Progress(total, total, True, False)
        board.push_uci(line[2 * index + 1])
    reply = line[2 * correct - 1] if 0 < correct < total else None
    return Progress(correct, total, correct == total, False, reply)


def puzzle_progress(puzzle: Puzzle, played: list[str]) -> Progress:
    """Сверка ходов игрока с решением задачи базы (moves без первого хода — он сделан соперником до вопроса)."""
    return play(question_position(puzzle), puzzle.moves.split()[1:], played)


def is_correct(puzzle: Puzzle, uci: str) -> bool:
    """Первый ход решения (или любой мат) — для обратной совместимости с ответом «один ход»."""
    return puzzle_progress(puzzle, [uci]).correct > 0


def estimate(answers: list[tuple[int, float]]) -> int:
    """
    Сила по ответам: максимум правдоподобия P(верно) = 1 / (1 + 10^((r_задачи − r)/400)) с «ничьей» против 1500.
    Результат по задаче — доля найденных ходов решения (0…1; True/False — частные случаи). «Ничья» против 1500 —
    добавленные победа и поражение от задачи с рейтингом 1500: они удерживают оценку от ухода в край при всех верных
    или всех неверных ответах. Перебираются значения от 300 до 3000 с шагом 10.
    """
    def log_likelihood(r: float) -> float:
        total = 0.0
        for rating, score in [*answers, (1500, 1.0), (1500, 0.0)]:
            p = 1 / (1 + 10 ** ((rating - r) / 400))
            total += float(score) * math.log(p) + (1 - float(score)) * math.log(1 - p)
        return total

    return max(range(300, 3001, 10), key=log_likelihood)


def level(rating: int) -> str:
    """Код уровня по оценке силы (таблица LEVELS): до 1000 — novice, …, от 2000 — master."""
    return next(code for limit, code in LEVELS if rating < limit)


@dataclass
class Graded:
    """
    Итог экзамена: сколько позиций решено, оценка силы, разбор по позициям, профиль по ветвям и очки за верные ходы.
    """
    section: str
    correct: int
    total: int
    estimate: int
    review: list[dict]
    branches: dict[str, dict] | None = None
    # Очки: верные ходы по всем позициям из возможных (таск B.4 — решение доигрывается до конца).
    points: int = 0
    max_points: int = 0


def _review_row(qid: int, played: list[str], progress: Progress, board: chess.Board, solution: str, rating: int) -> dict:
    return {"id": qid, "answer": played[0] if played else "0000", "correct": progress.solved, "solution": solution,
            "solution_san": board.san(chess.Move.from_uci(solution)), "rating": rating,
            "points": progress.correct, "max_points": progress.total}


def _graded(section: str, review: list[dict], scored: list[tuple[int, float]],
            branches: dict[str, dict] | None = None) -> Graded:
    return Graded(section, sum(int(row["correct"]) for row in review), len(review), estimate(scored), review, branches,
                  points=sum(row["points"] for row in review), max_points=sum(row["max_points"] for row in review))


def _grade_level(user_id: int, section: str, answers: list[tuple[int, list[str]]]) -> tuple[Graded, ExamResult]:
    """Проверка экзамена уровня курса по фиксированному набору: итог с профилем по ветвям и строка результата."""
    review: list[dict] = []
    scored: list[tuple[int, float]] = []
    for qid, played in answers:
        item = level_exam.question(section, qid)
        if item is None:
            raise DomainValueError("exam_question_unknown")
        progress = level_exam.progress(item, played)
        scored.append((item["rating"], progress.share))
        review.append({**_review_row(qid, played, progress, chess.Board(item["fen"]), item["answer"], item["rating"]),
                       "branch": item["branch"]})
    result = _graded(section, review, scored, level_exam.branch_profile(review))
    return result, ExamResult(user_id=user_id, section=section, correct=result.correct, total=result.total,
                              estimate=result.estimate)


async def _section_puzzle(db: AsyncSession, section: str, puzzle_id: int) -> Puzzle:
    """
    Задача вопроса, если она относится к темам раздела; иначе exam_question_unknown — так нельзя проверить ходом
    экзамена произвольную задачу базы.
    """
    if section != ENDGAME and section not in EXAM_SECTIONS:
        raise DomainValueError("exam_section_unknown")
    puzzle = await db.get(Puzzle, puzzle_id)
    themes = set((await db.scalars(select(PuzzleTheme.theme).where(PuzzleTheme.puzzle_id == puzzle_id))).all())
    if puzzle is None or not themes & set(themes_of(section)):
        raise DomainValueError("exam_question_unknown")
    return puzzle


async def check_moves(db: AsyncSession, section: str, question_id: int, played: list[str]) -> Progress:
    """Ход игрока во время теста: верен ли и чем отвечает соперник (решение целиком клиенту не отдаётся)."""
    if level_exam.is_level_section(section):
        item = level_exam.question(section, question_id)
        if item is None:
            raise DomainValueError("exam_question_unknown")
        return level_exam.progress(item, played)
    return puzzle_progress(await _section_puzzle(db, section, question_id), played)


async def grade(db: AsyncSession, user_id: int, section: str, answers: list[tuple[int, list[str]]]) -> Graded:
    """
    Проверка ответов экзамена раздела: решение каждой позиции доигрывается до конца, считаются очки за верные ходы и
    оценка силы. Возвращает итог (Graded). answers — пары (номер вопроса, ходы игрока). Результат добавляется в
    exam_results без commit — его делает маршрут. Вопрос не из этого раздела — exam_question_unknown.
    """
    if level_exam.is_level_section(section):
        graded, row = _grade_level(user_id, section, answers)
        db.add(row)
        return graded
    if section != ENDGAME and section not in EXAM_SECTIONS:
        raise DomainValueError("exam_section_unknown")
    codes = set(themes_of(section))
    ids = [pid for pid, _ in answers]
    puzzles = {p.id: p for p in (await db.execute(select(Puzzle).where(Puzzle.id.in_(ids)))).scalars().all()}
    themes: dict[int, set[str]] = {}
    for pid, theme in (await db.execute(select(PuzzleTheme.puzzle_id, PuzzleTheme.theme)
                                        .where(PuzzleTheme.puzzle_id.in_(ids)))).tuples():
        themes.setdefault(pid, set()).add(theme)
    review: list[dict] = []
    scored: list[tuple[int, float]] = []
    for pid, played in answers:
        puzzle = puzzles.get(pid)
        if puzzle is None or not themes.get(pid, set()) & codes:
            raise DomainValueError("exam_question_unknown")
        progress = puzzle_progress(puzzle, played)
        scored.append((puzzle.rating, progress.share))
        review.append(_review_row(pid, played, progress, question_position(puzzle), puzzle.moves.split()[1],
                                  puzzle.rating))
    result = _graded(section, review, scored)
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
