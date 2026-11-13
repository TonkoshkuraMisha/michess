# --- FILE: src/services/puzzles.py ---
"""
Решение задач (таск 13.2). Решение клиенту не отправляется: сервер хранит, на каком ходу решающий (Redis, одна
активная задача на игрока), проверяет каждый ход и отвечает ходом соперника. Мат засчитывается всегда, даже если в
решении базы другой ход. Первая ошибка завершает задачу (как в партии: ход не вернуть) — тогда решение
показывается целиком.

Рейтинг решателя — Эло против рейтинга задачи: K = 40 первые PROVISIONAL_GAMES задач, затем 20. Подсказка снижает
начисление: одна — вдвое, две (показан ход) — до нуля; поражение считается полностью. Серия — подряд решённые без
ошибок и подсказок. «Задача дня» — одна на всех: выбирается по дате из популярных задач среднего уровня.

Режим на время (таск 13.3): забег на 3 или 5 минут хранится на сервере — счёт и ошибки считает сервер, клиент лишь
показывает таймер. Задачи забега рейтинг не меняют; сложность растёт с каждой решённой (от рейтинга игрока −300 с
шагом TIMED_STEP). Три ошибки или конец времени — забег окончен, лучший счёт — личный рекорд.

Тренировка по приёмам (таск 13.4): задачи темы на текущей ступени игрока (1–4); ступень пройдена, когда из последних
STAGE_WINDOW задач не меньше STAGE_PASS решены чисто (без ошибки и подсказки). Смешанная подборка — по разделу
каталога; «без названия темы» — темы задачи не показываются до конца решения.
"""

import datetime as dt
import json
import time
import uuid
import zlib
from dataclasses import asdict, dataclass

import chess
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError, DomainValueError
from src.db import redis as redis_module
from src.models.puzzle import Puzzle, PuzzleAttempt, PuzzleTheme, ThemeProgress
from src.models.user import User
from src.services.themes import SECTIONS, THEMES, THEMES_BY_CODE

SESSION_TTL_S = 2 * 60 * 60
RECENT_EXCLUDED = 300
RATING_WINDOWS = (75, 150, 300, 600, None)
PROVISIONAL_GAMES = 30
MIN_RATING = 400
HINT_FACTORS = (1.0, 0.5, 0.0)
DAILY_RATING = (1300, 1900)
DAILY_POPULARITY = 95
TIMED_MINUTES = (3, 5)
TIMED_MISTAKES = 3
TIMED_START_OFFSET = -300
TIMED_STEP = 40
TIMED_GRACE_S = 2
STAGES = (1, 2, 3, 4)
STAGE_WINDOW = 10
STAGE_PASS = 8


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
    run: str | None = None  # забег режима на время: задача без рейтинга
    training: str | None = None  # тренировка по теме: её код (прогресс темы обновляется по итогу)
    stage: int | None = None


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


async def pick_puzzle(
        db: AsyncSession, user: User, theme: str | None = None, target_rating: int | None = None,
) -> Puzzle:
    """Задача под рейтинг игрока (окно расширяется, пока не найдётся), по теме, без недавних."""
    if theme is not None and theme not in THEMES_BY_CODE:
        raise PuzzleError("unknown_theme", 400, theme=theme)
    recent = await _recent_ids(db, user.id)
    target = user.puzzle_rating if target_rating is None else target_rating
    for window in RATING_WINDOWS:
        query = select(Puzzle)
        if theme is not None:
            query = query.join(PuzzleTheme).where(PuzzleTheme.theme == theme)
        if window is not None:
            query = query.where(Puzzle.rating.between(target - window, target + window))
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


async def start(user: User, puzzle: Puzzle, *, daily: bool = False, run: str | None = None,
                training: str | None = None, stage: int | None = None) -> None:
    """Начать задачу: предыдущая незаконченная просто отменяется (без изменения рейтинга)."""
    await _save_session(user.id, PuzzleSession(puzzle_id=puzzle.id, daily=daily, run=run, training=training,
                                               stage=stage))


# --- тренировка по приёмам -----------------------------------------------------------------------------------

_stage_counts: dict[tuple[str, int], int] | None = None


async def stage_counts(db: AsyncSession) -> dict[tuple[str, int], int]:
    """
    Сколько задач у каждой темы на каждой ступени. База задач меняется только импортом — считается один раз.
    Темы «Что грозит соперник?» и «Не зевни» решаются защитными упражнениями (таск 13.6) — их счёт оттуда.
    """
    from src.services import defense_drills

    global _stage_counts
    if _stage_counts is None:
        rows = await db.execute(
            select(PuzzleTheme.theme, Puzzle.stage, func.count()).join(Puzzle, Puzzle.id == PuzzleTheme.puzzle_id)
            .group_by(PuzzleTheme.theme, Puzzle.stage)
        )
        counts = {(theme, stage): count for theme, stage, count in rows}
        for key, count in (await defense_drills.stage_counts(db)).items():
            counts[key] = counts.get(key, 0) + count
        _stage_counts = counts
    return _stage_counts


def reset_stage_counts() -> None:
    """После импорта задач и в тестах."""
    global _stage_counts
    _stage_counts = None


async def _progress(db: AsyncSession, user_id: int, theme: str) -> ThemeProgress | None:
    return await db.get(ThemeProgress, (user_id, theme))


async def pick_training(
        db: AsyncSession, user: User, *, theme: str | None = None, section: str | None = None,
        stage: int | None = None,
) -> tuple[Puzzle, int | None]:
    """Задача тренировки: по теме (ступень — из прогресса, если не задана) или смешанная по разделу."""
    if (theme is None) == (section is None):
        raise PuzzleError("training_target_required", 400)
    if theme is not None and theme not in THEMES_BY_CODE:
        raise PuzzleError("unknown_theme", 400, theme=theme)
    if section is not None and section not in SECTIONS:
        raise PuzzleError("unknown_section", 400, section=section)
    if stage is not None and stage not in STAGES:
        raise PuzzleError("invalid_stage", 400, stage=stage)
    if theme is not None and stage is None:
        progress = await _progress(db, user.id, theme)
        stage = min(progress.stage, STAGES[-1]) if progress else 1
    codes = [theme] if theme is not None else [t.code for t in THEMES if t.section == section]
    recent = await _recent_ids(db, user.id)
    # Смешанная подборка — под рейтинг игрока, окно расширяется; по теме сложность задаёт ступень.
    windows: tuple[int | None, ...] = (None,) if stage is not None else (300, 600, None)
    for exclude, window in ((e, w) for e in (True, False) for w in windows):
        query = select(Puzzle).join(PuzzleTheme).where(PuzzleTheme.theme.in_(codes))
        if stage is not None:
            query = query.where(Puzzle.stage == stage)
        elif window is not None:
            query = query.where(Puzzle.rating.between(user.puzzle_rating - window, user.puzzle_rating + window))
        if exclude and recent:
            query = query.where(Puzzle.id.not_in(recent))
        puzzle = await db.scalar(query.order_by(func.random()).limit(1))
        if puzzle is not None:
            return puzzle, stage
    raise PuzzleError("no_puzzles_available", 404)


async def update_theme_progress(db: AsyncSession, user_id: int, theme: str, stage: int, clean: bool) -> dict:
    """Засчитать результат ступени темы (задача тренировки или защитное упражнение 13.6); коммит — за вызывающим."""
    progress = await _progress(db, user_id, theme)
    if progress is None:
        progress = ThemeProgress(user_id=user_id, theme=theme, stage=1, recent="", solved=0, mastered=False)
        db.add(progress)
    advanced = False
    # Результат засчитывается ступени, которую игрок проходит сейчас (повтор пройденной ступени не мешает).
    if stage == progress.stage and not progress.mastered:
        progress.recent = (progress.recent + ("1" if clean else "0"))[-STAGE_WINDOW:]
        if progress.recent.count("1") >= STAGE_PASS:
            advanced = True
            progress.recent = ""
            if progress.stage >= STAGES[-1]:
                progress.mastered = True
            else:
                progress.stage += 1
    if clean:
        progress.solved += 1
    return {"theme": theme, "stage": progress.stage, "recent": progress.recent, "mastered": progress.mastered,
            "advanced": advanced, "window": STAGE_WINDOW, "pass": STAGE_PASS}


async def demo_puzzles(db: AsyncSession, theme: str, count: int = 2) -> list[dict]:
    """
    Показ приёма на доске: самые популярные задачи темы с самой лёгкой ступени — вместе с решением. Это не
    попытка: сессия не создаётся, рейтинг и история не меняются.
    """
    if theme not in THEMES_BY_CODE:
        raise PuzzleError("unknown_theme", 400, theme=theme)
    rows = await db.execute(
        select(Puzzle).join(PuzzleTheme).where(PuzzleTheme.theme == theme)
        .order_by(Puzzle.stage, Puzzle.popularity.desc(), Puzzle.plays.desc(), Puzzle.id).limit(count)
    )
    return [{"fen": p.fen, "moves": p.moves.split(), "color": solver_color(p)} for p in rows.scalars()]


async def training_overview(db: AsyncSession, user: User) -> dict:
    """Прогресс по всем темам и сколько задач есть на каждой ступени (тема готова к выдаче, когда хватает минимумов)."""
    counts = await stage_counts(db)
    rows = await db.execute(select(ThemeProgress).where(ThemeProgress.user_id == user.id))
    progress = {p.theme: p for p in rows.scalars()}
    themes = []
    for theme in THEMES:
        own = progress.get(theme.code)
        available = [counts.get((theme.code, stage), 0) for stage in STAGES]
        themes.append({
            "code": theme.code,
            "section": theme.section,
            "stage": own.stage if own else 1,
            "recent": own.recent if own else "",
            "solved": own.solved if own else 0,
            "mastered": bool(own and own.mastered),
            "available": available,
            "ready": all(n >= minimum for n, minimum in zip(available, theme.minimums, strict=True)),
        })
    return {"window": STAGE_WINDOW, "pass": STAGE_PASS, "themes": themes}


# --- режим на время -------------------------------------------------------------------------------------------

def _run_key(user_id: int) -> str:
    return f"puzzle:run:{user_id}"


async def _load_run(user_id: int) -> dict | None:
    raw = await redis_module.redis_client.get(_run_key(user_id))
    return json.loads(raw) if raw else None


async def _save_run(user_id: int, run: dict) -> None:
    ttl = int(run["ends_at"] - time.time()) + 600
    await redis_module.redis_client.set(_run_key(user_id), json.dumps(run), ex=max(ttl, 60))


def _run_view(run: dict) -> dict:
    return {
        "run_id": run["id"], "minutes": run["minutes"], "solved": run["solved"], "mistakes": run["mistakes"],
        "seconds_left": max(0, round(run["ends_at"] - time.time())), "over": _run_over(run),
    }


def _run_over(run: dict) -> bool:
    return run["mistakes"] >= TIMED_MISTAKES or time.time() > run["ends_at"] + TIMED_GRACE_S


async def start_run(user: User, minutes: int) -> dict:
    if minutes not in TIMED_MINUTES:
        raise PuzzleError("invalid_timed_minutes", 400, minutes=minutes)
    run = {"id": uuid.uuid4().hex, "minutes": minutes, "ends_at": time.time() + minutes * 60,
           "solved": 0, "mistakes": 0, "base": user.puzzle_rating + TIMED_START_OFFSET}
    await _save_run(user.id, run)
    await _drop_session(user.id)
    return _run_view(run)


async def next_in_run(db: AsyncSession, user: User) -> tuple[Puzzle, dict]:
    run = await _load_run(user.id)
    if run is None:
        raise PuzzleError("timed_run_not_active", 409)
    if _run_over(run):
        raise PuzzleError("timed_run_over", 409)
    target = max(600, run["base"] + TIMED_STEP * run["solved"])
    puzzle = await pick_puzzle(db, user, target_rating=target)
    await start(user, puzzle, run=run["id"])
    return puzzle, _run_view(run)


async def _count_in_run(user_id: int, run_id: str, solved: bool) -> dict | None:
    run = await _load_run(user_id)
    if run is None or run["id"] != run_id:
        return None
    if not _run_over(run):
        run["solved" if solved else "mistakes"] += 1
        await _save_run(user_id, run)
    return _run_view(run)


async def finish_run(db: AsyncSession, user: User) -> dict:
    """Итог забега: счёт, рекорд за эти минуты, новый ли это рекорд."""
    run = await _load_run(user.id)
    if run is None:
        raise PuzzleError("timed_run_not_active", 409)
    await redis_module.redis_client.delete(_run_key(user.id))
    await _drop_session(user.id)
    field = f"puzzle_best_{run['minutes']}"
    best = getattr(user, field)
    record = run["solved"] > best
    if record:
        setattr(user, field, run["solved"])
        await db.commit()
    return {"score": run["solved"], "mistakes": run["mistakes"], "minutes": run["minutes"],
            "best": max(best, run["solved"]), "new_record": record}


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
    if session.run is None:
        delta = rating_delta(before, puzzle.rating, user.puzzle_games, solved, session.hints)
        user.puzzle_rating = max(MIN_RATING, before + delta)
        user.puzzle_games += 1
    db.add(PuzzleAttempt(user_id=user.id, puzzle_id=puzzle.id, solved=solved, hints_used=session.hints,
                         rating_before=before, rating_after=user.puzzle_rating))
    training = None
    if session.training and session.stage:
        training = await update_theme_progress(db, user.id, session.training, session.stage,
                                          clean=solved and session.hints == 0)
    await db.commit()
    await _drop_session(user.id)
    run = await _count_in_run(user.id, session.run, solved) if session.run else None
    return {
        "run": run,
        "training": training,
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
            "best": {"3": user.puzzle_best_3, "5": user.puzzle_best_5}, "history": history}
