# --- FILE: src/services/guess.py ---
"""
«Угадай ход мастера» (таск 14.3): выдача отобранных позиций и оценка ответа.

Баллы: ход мастера — 100; другой ход не хуже лучшего на NEAR_CP — 80; хуже — по потере: 80 − (потеря − NEAR_CP) / 5,
не меньше нуля. Оценка — по сохранённым строкам движка (до трёх лучших ходов), без запуска движка: ход вне этих строк
не лучше второй строки (отбор гарантирует её отставание), поэтому его потеря — отрыв лучшего хода плюс запас.
"""

import io
import random

import chess
import chess.pgn
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game
from src.models.guess import GuessPosition
from src.services.coach import advice_for_position

MASTER_SCORE = 100
NEAR_SCORE = 80
NEAR_CP = 30
UNKNOWN_EXTRA_CP = 50
CONTEXT_MOVES = 8
DIFFICULTY_BAND = 300


def score_answer(position: GuessPosition, move_uci: str) -> tuple[int, int]:
    """(баллы, потеря в сп) за ответ игрока."""
    if move_uci == position.move_uci:
        return MASTER_SCORE, 0
    known = {uci: cp for uci, cp in position.lines}
    loss = position.best_cp - known[move_uci] if move_uci in known else position.gap_cp + UNKNOWN_EXTRA_CP
    loss = max(0, loss)
    if loss <= NEAR_CP:
        return NEAR_SCORE, loss
    return max(0, NEAR_SCORE - (loss - NEAR_CP) // 5), loss


def _game_context(game: Game, ply: int) -> dict:
    """Игроки, событие и ходы партии перед позицией (для подписи и ленты ходов)."""
    parsed = chess.pgn.read_game(io.StringIO(game.pgn or ""))
    if parsed is None:
        return {"white": "?", "black": "?", "event": None, "date": None, "previous": [], "last_move": None}
    board = parsed.board()
    sans: list[str] = []
    last_move = None
    for index, move in enumerate(parsed.mainline_moves()):
        if index >= ply:
            break
        sans.append(board.san(move))
        board.push(move)
        last_move = move.uci()
    headers = parsed.headers
    return {
        "white": headers.get("White", "?"), "black": headers.get("Black", "?"),
        "event": headers.get("Event") if headers.get("Event", "?") != "?" else None,
        "date": (headers.get("Date") or "")[:4] or None,
        "previous": sans[-CONTEXT_MOVES:], "first_previous_ply": max(0, len(sans) - CONTEXT_MOVES),
        "last_move": last_move,
    }


async def payload(db: AsyncSession, position: GuessPosition) -> dict:
    game = await db.get(Game, position.game_id)
    series_length = 0
    if position.series_id is not None:
        series_length = (await db.execute(
            select(func.count()).select_from(GuessPosition).where(GuessPosition.series_id == position.series_id)
        )).scalar_one()
    return {
        "id": position.id, "game_id": position.game_id, "ply": position.ply, "fen": position.fen,
        "side": "white" if position.ply % 2 == 0 else "black", "move_number": position.ply // 2 + 1,
        "difficulty": position.difficulty,
        "series_id": position.series_id, "series_index": position.series_index, "series_length": series_length,
        **(_game_context(game, position.ply) if game else {}),
    }


async def pick_position(db: AsyncSession, target: int, series: bool) -> GuessPosition | None:
    """Случайная позиция (или начало серии) около сложности target; если рядом нет — любая."""
    query = select(GuessPosition)
    if series:
        query = query.where(GuessPosition.series_id.is_not(None), GuessPosition.series_index == 0)
    near = query.where(GuessPosition.difficulty.between(target - DIFFICULTY_BAND, target + DIFFICULTY_BAND))
    for candidate_query in (near, query):
        ids = (await db.execute(candidate_query.with_only_columns(GuessPosition.id))).scalars().all()
        if ids:
            return await db.get(GuessPosition, random.choice(ids))
    return None


async def series_next(db: AsyncSession, position: GuessPosition) -> GuessPosition | None:
    if position.series_id is None:
        return None
    return (await db.execute(select(GuessPosition).where(
        GuessPosition.series_id == position.series_id, GuessPosition.series_index == position.series_index + 1,
    ))).scalar_one_or_none()


async def game_positions(db: AsyncSession, game_id: int) -> list[GuessPosition]:
    return list((await db.execute(
        select(GuessPosition).where(GuessPosition.game_id == game_id).order_by(GuessPosition.ply)
    )).scalars())


async def answer(db: AsyncSession, position: GuessPosition, move_uci: str) -> dict:
    """Баллы, ход мастера, строки движка и объяснение наставника к ходу мастера."""
    board = chess.Board(position.fen)
    score, loss = score_answer(position, move_uci)
    position.plays += 1
    if score == MASTER_SCORE:
        position.solved += 1
    await db.commit()
    master = chess.Move.from_uci(position.move_uci)
    advice = advice_for_position(board, position.move_uci)
    next_in_series = await series_next(db, position)
    return {
        "score": score, "loss_cp": loss, "master_move": position.move_uci, "master_san": board.san(master),
        "lines": [{"uci": uci, "san": board.san(chess.Move.from_uci(uci)), "cp": cp} for uci, cp in position.lines],
        "comment": advice["comment"], "arrows": advice["arrows"],
        "next_id": next_in_series.id if next_in_series else None,
    }
