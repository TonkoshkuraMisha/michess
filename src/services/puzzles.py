# --- FILE: src/services/puzzles.py ---
"""
Решение задач (таск 13.2). Решение клиенту не отправляется: сервер хранит, на каком ходу решающий (Redis, одна
активная задача на игрока), проверяет каждый ход и отвечает ходом соперника. Мат засчитывается всегда, даже если в
решении базы другой ход. Первая ошибка завершает задачу (как в партии: ход не вернуть) — тогда решение
показывается целиком.

Рейтинг решателя — Эло против рейтинга задачи: K = 40 первые PROVISIONAL_GAMES задач, затем 20. Подсказка снижает
начисление: одна — вдвое, две (показан ход) — до нуля; поражение считается полностью. Серия — подряд решённые без
ошибок и подсказок. «Задача дня» — одна на всех: выбирается по дате из популярных задач среднего уровня.
"""

import datetime as dt
import json
import zlib
from dataclasses import asdict, dataclass

import chess
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError, DomainValueError
from src.db import redis as redis_module
from src.models.puzzle import Puzzle, PuzzleAttempt, PuzzleTheme
from src.models.user import User
from src.services.themes import THEMES_BY_CODE

SESSION_TTL_S = 2 * 60 * 60
RECENT_EXCLUDED = 300
RATING_WINDOWS = (75, 150, 300, 600, None)
PROVISIONAL_GAMES = 30
MIN_RATING = 400
HINT_FACTORS = (1.0, 0.5, 0.0)
DAILY_RATING = (1300, 1900)
DAILY_POPULARITY = 95


class PuzzleError(DomainError):
    """Ошибка решения задачи с кодом каталога и HTTP-статусом."""

    def __init__(self, code: str, status: int, **params: object):
        super().__init__(code, **params)
        self.status = status


@dataclass
class PuzzleSession:
    puzzle_id: int
    index: int = 1          # индекс ожидаемого хода решающего в moves
    hints: int = 0
    daily: bool = False


def _session_key(user_id: int) -> str:
    return f"puzzle:session:{user_id}"


async def _load_session(user_id: int) -> PuzzleSession | None:
    raw = await redis_module.redis_client.get(_session_key(user_id))
    return PuzzleSession(**json.loads(raw)) if raw else None


async def _save_session(user_id: int, session: PuzzleSession) -> None:
    await redis_module.redis_client.set(_session_key(user_id), json.dumps(asdict(session)), ex=SESSION_TTL_S)


async def _drop_session(user_id: int) -> None:
    await redis_module.redis_client.delete(_session_key(user_id))


def solver_color(puzzle: Puzzle) -> str:
    """Цвет решающего: сторона, которая ходит после первого хода соперника."""
    return "black" if puzzle.fen.split()[1] == "w" else "white"


def public_view(puzzle: Puzzle, *, show_themes: bool = True) -> dict:
    """Что видит клиент: позиция, первый ход соперника, рейтинг, темы и сколько ходов в решении — но не решение."""
    moves = puzzle.moves.split()
    return {
        "id": puzzle.id,
        "fen": puzzle.fen,
        "first_move": moves[0],
        "rating": puzzle.rating,
        "themes": puzzle.theme_codes if show_themes else [],
        "color": solver_color(puzzle),
        "solution_length": len(moves[1::2]),
    }


async def _recent_ids(db: AsyncSession, user_id: int) -> list[int]:
    rows = await db.execute(
        select(PuzzleAttempt.puzzle_id).where(PuzzleAttempt.user_id == user_id)
        .order_by(PuzzleAttempt.created_at.desc(), PuzzleAttempt.id.desc()).limit(RECENT_EXCLUDED)
    )
    return list(rows.scalars())


async def pick_puzzle(db: AsyncSession, user: User, theme: str | None = None) -> Puzzle:
    """Задача под рейтинг игрока (окно расширяется, пока не найдётся), по теме, без недавних."""
    if theme is not None and theme not in THEMES_BY_CODE:
        raise PuzzleError("unknown_theme", 400, theme=theme)
    recent = await _recent_ids(db, user.id)
    for window in RATING_WINDOWS:
        query = select(Puzzle)
        if theme is not None:
            query = query.join(PuzzleTheme).where(PuzzleTheme.theme == theme)
        if window is not None:
            query = query.where(Puzzle.rating.between(user.puzzle_rating - window, user.puzzle_rating + window))
        if recent:
            query = query.where(Puzzle.id.not_in(recent))
        puzzle = await db.scalar(query.order_by(func.random()).limit(1))
        if puzzle is not None:
            return puzzle
    # Всё подходящее недавно решалось (узкая тема) — лучше повторить, чем оставить игрока без задачи.
    query = select(Puzzle)
    if theme is not None:
        query = query.join(PuzzleTheme).where(PuzzleTheme.theme == theme)
    puzzle = await db.scalar(query.order_by(func.random()).limit(1))
    if puzzle is not None:
        return puzzle
    raise PuzzleError("no_puzzles_available", 404)


async def daily_puzzle(db: AsyncSession, day: dt.date) -> Puzzle:
    """Одна задача на всех на этот день: популярная, среднего уровня, по дате."""
    condition: ColumnElement[bool] = (Puzzle.popularity >= DAILY_POPULARITY) & Puzzle.rating.between(*DAILY_RATING)
    count = await db.scalar(select(func.count()).select_from(Puzzle).where(condition)) or 0
    if count == 0:
        condition = Puzzle.id.is_not(None)
        count = await db.scalar(select(func.count()).select_from(Puzzle)) or 0
    if count == 0:
        raise PuzzleError("no_puzzles_available", 404)
    offset = zlib.crc32(day.isoformat().encode()) % count
    puzzle = await db.scalar(select(Puzzle).where(condition).order_by(Puzzle.id).offset(offset).limit(1))
    assert puzzle is not None
    return puzzle


async def start(user: User, puzzle: Puzzle, *, daily: bool = False) -> None:
    """Начать задачу: предыдущая незаконченная просто отменяется (без изменения рейтинга)."""
    await _save_session(user.id, PuzzleSession(puzzle_id=puzzle.id, daily=daily))


async def _active(db: AsyncSession, user: User, puzzle_id: int) -> tuple[PuzzleSession, Puzzle]:
    session = await _load_session(user.id)
    if session is None or session.puzzle_id != puzzle_id:
        raise PuzzleError("puzzle_not_active", 409, puzzle_id=puzzle_id)
    puzzle = await db.get(Puzzle, puzzle_id)
    if puzzle is None:
        await _drop_session(user.id)
        raise PuzzleError("puzzle_not_found", 404, puzzle_id=puzzle_id)
    return session, puzzle


def _board_at(puzzle: Puzzle, index: int) -> chess.Board:
    board = chess.Board(puzzle.fen)
    for uci in puzzle.moves.split()[:index]:
        board.push_uci(uci)
    return board


def rating_delta(user_rating: int, puzzle_rating: int, games: int, solved: bool, hints: int) -> int:
    k = 40 if games < PROVISIONAL_GAMES else 20
    expected = 1 / (1 + 10 ** ((puzzle_rating - user_rating) / 400))
    delta = k * ((1 if solved else 0) - expected)
    if solved:
        delta *= HINT_FACTORS[min(hints, len(HINT_FACTORS) - 1)]
    return round(delta)


async def streak(db: AsyncSession, user_id: int) -> int:
    """Подряд решённые задачи без подсказок — от последней попытки назад."""
    rows = await db.execute(
        select(PuzzleAttempt.solved, PuzzleAttempt.hints_used).where(PuzzleAttempt.user_id == user_id)
        .order_by(PuzzleAttempt.created_at.desc(), PuzzleAttempt.id.desc()).limit(500)
    )
    count = 0
    for solved, hints in rows:
        if not solved or hints:
            break
        count += 1
    return count


async def _finish(db: AsyncSession, user: User, puzzle: Puzzle, session: PuzzleSession, solved: bool) -> dict:
    before = user.puzzle_rating
    delta = rating_delta(before, puzzle.rating, user.puzzle_games, solved, session.hints)
    user.puzzle_rating = max(MIN_RATING, before + delta)
    user.puzzle_games += 1
    db.add(PuzzleAttempt(user_id=user.id, puzzle_id=puzzle.id, solved=solved, hints_used=session.hints,
                         rating_before=before, rating_after=user.puzzle_rating))
    await db.commit()
    await _drop_session(user.id)
    return {
        "solved": solved,
        "rating_before": before,
        "rating_after": user.puzzle_rating,
        "delta": user.puzzle_rating - before,
        "streak": await streak(db, user.id),
        "themes": puzzle.theme_codes,
    }


async def play(db: AsyncSession, user: User, puzzle_id: int, uci: str) -> dict:
    """Ход решающего: верно — ответ соперника или итог; неверно — итог с решением."""
    session, puzzle = await _active(db, user, puzzle_id)
    moves = puzzle.moves.split()
    board = _board_at(puzzle, session.index)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=uci) from None
    if move not in board.legal_moves:
        raise DomainValueError("illegal_move", move=uci)

    board.push(move)
    correct = uci == moves[session.index] or board.is_checkmate()
    if not correct:
        solution = moves[session.index:]
        return {"correct": False, "done": True, "reply": None, "solution": solution,
                "result": await _finish(db, user, puzzle, session, solved=False)}

    session.index += 1
    if board.is_checkmate() or session.index >= len(moves):
        return {"correct": True, "done": True, "reply": None, "solution": None,
                "result": await _finish(db, user, puzzle, session, solved=True)}
    reply = moves[session.index]
    session.index += 1
    if session.index >= len(moves):
        # Решение базы всегда кончается ходом решающего; на случай иной записи — задача решена.
        return {"correct": True, "done": True, "reply": reply, "solution": None,
                "result": await _finish(db, user, puzzle, session, solved=True)}
    await _save_session(user.id, session)
    return {"correct": True, "done": False, "reply": reply, "solution": None, "result": None}


async def hint(db: AsyncSession, user: User, puzzle_id: int) -> dict:
    """Подсказка: первая — поле фигуры, которой ходить; вторая — и поле, куда. Каждая снижает начисление."""
    session, puzzle = await _active(db, user, puzzle_id)
    expected = puzzle.moves.split()[session.index]
    session.hints = min(session.hints + 1, len(HINT_FACTORS) - 1)
    await _save_session(user.id, session)
    return {"from": expected[:2], "to": expected[2:4] if session.hints >= 2 else None, "hints_used": session.hints}


async def give_up(db: AsyncSession, user: User, puzzle_id: int) -> dict:
    """«Показать решение»: задача засчитывается нерешённой, решение — целиком."""
    session, puzzle = await _active(db, user, puzzle_id)
    solution = puzzle.moves.split()[session.index:]
    return {"solution": solution, "result": await _finish(db, user, puzzle, session, solved=False)}


async def profile(db: AsyncSession, user: User, limit: int = 30) -> dict:
    """Рейтинг решателя, число задач, серия и последние попытки (для графика и истории)."""
    rows = await db.execute(
        select(PuzzleAttempt, Puzzle.rating).join(Puzzle, Puzzle.id == PuzzleAttempt.puzzle_id)
        .where(PuzzleAttempt.user_id == user.id)
        .order_by(PuzzleAttempt.created_at.desc(), PuzzleAttempt.id.desc()).limit(limit)
    )
    history = [
        {"puzzle_id": attempt.puzzle_id, "puzzle_rating": rating, "solved": attempt.solved,
         "hints_used": attempt.hints_used, "rating_after": attempt.rating_after,
         "created_at": attempt.created_at.isoformat() if attempt.created_at else None}
        for attempt, rating in rows
    ]
    return {"rating": user.puzzle_rating, "games": user.puzzle_games, "streak": await streak(db, user.id),
            "history": history}
