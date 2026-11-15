# --- FILE: src/services/opening_explorer.py ---
"""
Справочник дебютов (таск 16.2): ходы из позиции со статистикой по индексу позиций (таск 16.1), название дебюта
(src/services/openings.py) и партии мастеров из архива, прошедшие через позицию.
"""

import chess
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.core.errors import DomainValueError
from src.models.game import Game
from src.models.position import PositionGame
from src.models.user import User
from src.services import openings, position_index

ARCHIVE_PASSWORD = "!historical_archive_no_login!"
MAX_MOVES = 60
MASTER_GAMES = 12


def board_after(moves_uci: list[str]) -> tuple[chess.Board, list[chess.Move]]:
    board = chess.Board()
    played = []
    for uci in moves_uci[:MAX_MOVES]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise DomainValueError("illegal_move", move=uci) from None
        if move not in board.legal_moves:
            raise DomainValueError("illegal_move", move=uci)
        board.push(move)
        played.append(move)
    return board, played


async def master_games(db: AsyncSession, board: chess.Board, limit: int = MASTER_GAMES) -> list[dict]:
    """Архивные партии (оба игрока — из архива), проходившие через позицию: новые по дате — первыми."""
    white, black = aliased(User), aliased(User)
    rows = (await db.execute(
        select(Game.id, white.username, black.username, Game.pgn_date, Game.result, Game.eco)
        .join(PositionGame, PositionGame.game_id == Game.id)
        .join(white, white.id == Game.white_player_id).join(black, black.id == Game.black_player_id)
        .where(PositionGame.position_hash == position_index.position_key(board),
               white.hashed_password == ARCHIVE_PASSWORD, black.hashed_password == ARCHIVE_PASSWORD)
        .order_by(Game.pgn_date.desc().nulls_last(), Game.id.desc()).limit(limit)
    )).all()
    return [
        {"id": gid, "white": w, "black": b, "year": (date or "")[:4] or None, "result": result, "eco": eco}
        for gid, w, b, date, result, eco in rows
    ]


async def explore(db: AsyncSession, moves_uci: list[str]) -> dict:
    board, played = board_after(moves_uci)
    opening = openings.classify_board_line(chess.Board(), played)
    stats = await position_index.moves_from(db, board)
    moves = []
    for stat in stats:
        move = chess.Move.from_uci(stat.move_uci)
        if move not in board.legal_moves:
            continue  # коллизия хэша — такого хода в позиции нет
        after = openings.classify_board_line(chess.Board(), [*played, move])
        moves.append({
            "uci": stat.move_uci, "san": board.san(move), "games": stat.games, "white_wins": stat.white_wins,
            "draws": stat.draws, "black_wins": stat.black_wins,
            "opening": {"eco": after.eco, "name": after.name} if after and after != opening else None,
        })
    return {
        "fen": board.fen(),
        "opening": {"eco": opening.eco, "name": opening.name} if opening else None,
        "moves": moves,
        "games": await master_games(db, board),
    }
