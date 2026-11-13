# --- FILE: src/services/personal_puzzles.py ---
"""
Задачи из партий игрока (таск 13.5). После разбора завершённой партии ищутся моменты, где игрок (не бот) ошибся
или упустил выигрыш, и из них делаются личные задачи «Ваши ошибки» — по тем же критериям объективной решаемости,
что «Угадай ход мастера» (14.3):

* ход партии — ошибка или грубая ошибка по разбору (потеря ≥ MIN_LOSS сп);
* у лучшего хода есть отрыв: второй по силе ход хуже на ≥ MIN_GAP сп (или лучший матует, а второй — нет) — иначе
  задача «угадывается», а не решается;
* лучший ход — не очевидное взятие незащищённой фигуры;
* не больше MAX_PER_PLAYER задач на игрока за партию (самые дорогие ошибки).

Повторение с интервалами: нерешённая задача возвращается через 1, 3, 7, 21 день; решённая дважды подряд — освоена.
"""

import asyncio
import datetime as dt
import json
import logging

import chess
import chess.engine
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainValueError
from src.models.game import Game
from src.models.puzzle import PersonalPuzzle
from src.models.user import User
from src.services.bots.base import resolve_stockfish_path
from src.services.engine_pool import EngineUnavailableError, get_engine_pool
from src.services.game_engine import read_pgn_game
from src.services.mentor_service import analyze_move
from src.services.themes import themes_for_motif

logger = logging.getLogger(__name__)

MIN_LOSS = 100
MIN_GAP = 200
MAX_PER_PLAYER = 3
ENGINE_DEPTH = 14
MATE_CP = 10_000
INTERVALS_DAYS = (1, 3, 7, 21)
SOLVES_TO_MASTER = 2


def _score(info: chess.engine.InfoDict, turn: chess.Color) -> int:
    return int(info["score"].pov(turn).score(mate_score=MATE_CP) or 0)


def top_two(board: chess.Board) -> list[tuple[str, int]] | None:
    """Два лучших хода с оценкой с точки зрения стороны, которая ходит. None — движка нет."""
    path = resolve_stockfish_path()
    if not path:
        return None
    with get_engine_pool(path).acquire() as engine:
        infos = engine.analyse(board, chess.engine.Limit(depth=ENGINE_DEPTH), multipv=2)
    if not isinstance(infos, list):
        infos = [infos]
    return [(info["pv"][0].uci(), _score(info, board.turn)) for info in infos if info.get("pv")]


def obvious_capture(board: chess.Board, move: chess.Move) -> bool:
    """Взятие незащищённой фигуры — его видно без расчёта, задачи из него не выйдет."""
    target = board.piece_at(move.to_square)
    if target is None or board.is_en_passant(move):
        return False
    return not board.attackers(target.color, move.to_square)


def is_solvable(board: chess.Board, best: chess.Move, candidates: list[tuple[str, int]]) -> bool:
    if obvious_capture(board, best):
        return False
    if not candidates or candidates[0][0] != best.uci():
        return False
    if len(candidates) == 1:
        return False  # единственный легальный ход — решать нечего
    (_, first), (_, second) = candidates[0], candidates[1]
    if first >= MATE_CP - 100 and second < MATE_CP - 100:
        return True
    return first - second >= MIN_GAP


def themes_of(board: chess.Board, move: chess.Move) -> list[str]:
    facts = analyze_move(board, move)
    after = board.copy(stack=False)
    after.push(move)
    codes: list[str] = []
    for motif in facts.created:
        piece = after.piece_at(motif.square)
        for code in themes_for_motif(motif.code, piece.symbol().lower() if piece else None):
            if code not in codes:
                codes.append(code)
    return codes


async def extract_for_game(db: AsyncSession, game_id: int) -> int:
    """Личные задачи из разобранной партии. Повторный вызов ничего не дублирует. Возвращает число новых задач."""
    game = await db.get(Game, game_id)
    if game is None or not game.analysis_json or not game.pgn:
        return 0
    try:
        moves_report = json.loads(game.analysis_json).get("moves", [])
    except ValueError:
        return 0
    players: dict[str, User] = {}
    for color, user_id in (("white", game.white_player_id), ("black", game.black_player_id)):
        user = await db.get(User, user_id)
        if user is not None and not user.is_bot:
            players[color] = user
    if not players:
        return 0
    existing = set((await db.execute(
        select(PersonalPuzzle.user_id, PersonalPuzzle.ply).where(PersonalPuzzle.game_id == game_id)
    )).all())

    pgn_game = read_pgn_game(game.pgn)
    if pgn_game is None:
        return 0
    board = pgn_game.board()
    positions: list[tuple[chess.Board, chess.Move, str | None]] = []
    previous: str | None = None
    for move in pgn_game.mainline_moves():
        positions.append((board.copy(stack=False), move, previous))
        previous = move.uci()
        board.push(move)

    candidates: dict[str, list[tuple[int, dict]]] = {color: [] for color in players}
    for index, item in enumerate(moves_report):
        color = item.get("color")
        if color not in players or index >= len(positions):
            continue
        if item.get("classification") not in ("Mistake", "Blunder") or int(item.get("cp_loss", 0)) < MIN_LOSS:
            continue
        if not item.get("best_move_uci") or item["best_move_uci"] == item.get("uci"):
            continue
        candidates[color].append((index, item))

    added = 0
    for color, items in candidates.items():
        user = players[color]
        chosen = 0
        for index, item in sorted(items, key=lambda pair: -int(pair[1].get("cp_loss", 0))):
            if chosen >= MAX_PER_PLAYER:
                break
            ply = index + 1
            if (user.id, ply) in existing:
                chosen += 1
                continue
            position, played, previous_move = positions[index]
            best = chess.Move.from_uci(item["best_move_uci"])
            if best not in position.legal_moves:
                continue
            try:
                top = await asyncio.to_thread(top_two, position.copy(stack=False))
            except EngineUnavailableError as exc:
                logger.warning("Stockfish недоступен для задач из партии %s: %s", game_id, exc)
                return added
            if top is None:
                return added
            if not is_solvable(position, best, top):
                continue
            db.add(PersonalPuzzle(
                user_id=user.id, game_id=game_id, ply=ply, fen=position.fen(), previous_move=previous_move,
                solution=best.uci(), played=played.uci(), cp_loss=int(item.get("cp_loss", 0)),
                themes=",".join(themes_of(position, best)),
            ))
            chosen += 1
            added += 1
    await db.commit()
    return added


# --- решение и повторение -------------------------------------------------------------------------------------

def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _aware(value: dt.datetime) -> dt.datetime:
    return value if value.tzinfo else value.replace(tzinfo=dt.UTC)


def view(puzzle: PersonalPuzzle) -> dict:
    board = chess.Board(puzzle.fen)
    return {
        "id": puzzle.id, "game_id": puzzle.game_id, "ply": puzzle.ply, "fen": puzzle.fen,
        "previous_move": puzzle.previous_move, "color": "white" if board.turn == chess.WHITE else "black",
        "themes": [code for code in puzzle.themes.split(",") if code],
        "attempts": puzzle.attempts, "solved_streak": puzzle.solved_streak,
    }


async def game_context(db: AsyncSession, puzzle: PersonalPuzzle, user: User) -> dict:
    """
    Откуда ошибка (таск B.3): соперник (бот — его id, клиент переводит имя; своя персоналия — её имя) и дата партии.
    """
    game = await db.get(Game, puzzle.game_id)
    if game is None:
        return {"opponent": None, "opponent_is_bot": False, "played_at": None}
    opponent_id = game.black_player_id if game.white_player_id == user.id else game.white_player_id
    opponent = await db.get(User, opponent_id)
    name = game.personality_name if game.personality_name and opponent is not None and opponent.is_bot else None
    when = game.finished_at or game.created_at
    return {
        "opponent": name or (opponent.username if opponent is not None else None),
        "opponent_is_bot": bool(opponent is not None and opponent.is_bot and not name),
        "played_at": _aware(when).isoformat() if when else None,
    }


async def summary(db: AsyncSession, user: User) -> dict:
    now = _now()
    total = await db.scalar(select(func.count()).select_from(PersonalPuzzle).where(
        PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(False))) or 0
    due = await db.scalar(select(func.count()).select_from(PersonalPuzzle).where(
        PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(False), PersonalPuzzle.due_at <= now)) or 0
    mastered = await db.scalar(select(func.count()).select_from(PersonalPuzzle).where(
        PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(True))) or 0
    upcoming = await db.scalar(select(func.min(PersonalPuzzle.due_at)).where(
        PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(False), PersonalPuzzle.due_at > now))
    return {"due": due, "active": total, "mastered": mastered,
            "next_due_at": _aware(upcoming).isoformat() if upcoming else None}


async def next_due(db: AsyncSession, user: User) -> PersonalPuzzle | None:
    return await db.scalar(
        select(PersonalPuzzle).where(PersonalPuzzle.user_id == user.id, PersonalPuzzle.done.is_(False),
                                     PersonalPuzzle.due_at <= _now())
        .order_by(PersonalPuzzle.due_at, PersonalPuzzle.id).limit(1)
    )


async def answer(db: AsyncSession, user: User, puzzle_id: int, uci: str) -> dict:
    """Ответ на личную задачу: верно — интервал растёт; неверно — снова завтра. Решена дважды подряд — освоена."""
    puzzle = await db.get(PersonalPuzzle, puzzle_id)
    if puzzle is None or puzzle.user_id != user.id:
        from src.services.puzzles import PuzzleError

        raise PuzzleError("puzzle_not_found", 404, puzzle_id=puzzle_id)
    board = chess.Board(puzzle.fen)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=uci) from None
    if move not in board.legal_moves:
        raise DomainValueError("illegal_move", move=uci)
    after = board.copy(stack=False)
    after.push(move)
    correct = uci == puzzle.solution or after.is_checkmate()
    puzzle.attempts += 1
    if correct:
        puzzle.solved_streak += 1
        if puzzle.solved_streak >= SOLVES_TO_MASTER:
            puzzle.done = True
        else:
            puzzle.interval_index = min(puzzle.interval_index + 1, len(INTERVALS_DAYS) - 1)
    else:
        puzzle.solved_streak = 0
        puzzle.interval_index = 0
    puzzle.due_at = _now() + dt.timedelta(days=INTERVALS_DAYS[puzzle.interval_index])
    await db.commit()
    return {
        "correct": correct, "solution": puzzle.solution, "played": puzzle.played, "done": puzzle.done,
        "solved_streak": puzzle.solved_streak, "next_due_at": None if puzzle.done else _aware(puzzle.due_at).isoformat(),
    }


async def plies_for_game(db: AsyncSession, game_id: int, user: User | None) -> list[int]:
    """Полуходы партии, из которых сделаны задачи (для значка в разборе): свои — владельцу партии."""
    if user is None:
        return []
    rows = await db.execute(select(PersonalPuzzle.ply).where(PersonalPuzzle.game_id == game_id,
                                                              PersonalPuzzle.user_id == user.id))
    return sorted(set(rows.scalars()))
