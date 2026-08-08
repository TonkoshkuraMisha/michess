import json
import chess
import chess.pgn
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from stockfish import Stockfish
from src.core.config import settings
from src.db.redis import redis_client
from src.models.move import Move
from src.models.game import Game, GameStatus


class AnalysisService:
    @staticmethod
    def _parse_move(board: chess.Board, move_str: str) -> chess.Move | None:
        """Вспомогательный метод для парсинга хода в формате UCI или SAN."""
        if len(move_str) in [4, 5]:
            try:
                uci_move = chess.Move.from_uci(move_str)
                if uci_move in board.legal_moves:
                    return uci_move
            except ValueError:
                pass

        try:
            san_move = board.parse_san(move_str)
            if san_move in board.legal_moves:
                return san_move
        except ValueError:
            pass

        return None

    @staticmethod
    async def analyze_position(db: AsyncSession, moves: list[str]) -> dict:
        board = chess.Board()

        for move_str in moves:
            move = AnalysisService._parse_move(board, move_str)
            if move:
                board.push(move)
            else:
                break

        current_fen = board.fen()
        sf_evaluation = AnalysisService._get_stockfish_evaluation(current_fen)
        continuation_stats = await AnalysisService._get_continuations_with_cache(db, moves)

        return {
            "fen": current_fen,
            "evaluation": sf_evaluation,
            "continuations": continuation_stats
        }

    @staticmethod
    def _get_stockfish_evaluation(fen: str) -> dict:
        try:
            sf = Stockfish(path=settings.AC_STOCKFISH_PATH, depth=12)
            sf.set_fen_position(fen)
            return sf.get_evaluation()
        except Exception:
            return {"type": "cp", "value": 0}

    @staticmethod
    async def _get_continuations_with_cache(db: AsyncSession, moves: list[str]) -> list[dict]:
        cache_key = f"opening:cache:{','.join(moves)}"

        cached_data = await redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)

        matching_game_ids = await AnalysisService._find_matching_games(db, moves)
        if not matching_game_ids:
            return []

        # Воссоздаем точное состояние доски для проверки очереди хода
        board = chess.Board()
        for move_str in moves:
            move = AnalysisService._parse_move(board, move_str)
            if move:
                board.push(move)

        next_move_number = len(moves) + 1

        query = select(
            Move.notation,
            func.count(Move.id).label("count")
        ).where(
            and_(
                Move.game_id.in_(matching_game_ids),
                Move.move_number == next_move_number
            )
        ).group_by(Move.notation).order_by(func.count(Move.id).desc())

        res = await db.execute(query)
        rows = res.all()

        # Строго фильтруем: оставляем ТОЛЬКО ходы, легальные для текущей стороны на доске
        valid_rows = []
        for row in rows:
            try:
                uci_move = chess.Move.from_uci(row.notation)
                if uci_move in board.legal_moves:
                    valid_rows.append(row)
            except ValueError:
                continue

        total = sum(row.count for row in valid_rows) if valid_rows else 1

        result = [
            {
                "move": row.notation,
                "count": row.count,
                "frequency": round((row.count / total) * 100, 1)
            }
            for row in valid_rows
        ]

        if result:
            await redis_client.set(cache_key, json.dumps(result), ex=86400)

        return result

    @staticmethod
    async def _find_matching_games(db: AsyncSession, moves: list[str]) -> list[int]:
        if not moves:
            res = await db.execute(select(Game.id.distinct()).where(Game.status == GameStatus.COMPLETED).limit(500))
            return [row[0] for row in res.all()]

        board = chess.Board()
        uci_moves = []
        for move_str in moves:
            move = AnalysisService._parse_move(board, move_str)
            if move:
                uci_moves.append(move.uci())
                board.push(move)
            else:
                break

        if not uci_moves:
            return []

        subqueries = []
        for idx, move_notation in enumerate(uci_moves, start=1):
            subq = select(Move.game_id).where(
                and_(
                    Move.move_number == idx,
                    Move.notation == move_notation
                )
            ).subquery()
            subqueries.append(subq)

        base_query = select(subqueries[0].c.game_id)
        for sq in subqueries[1:]:
            base_query = base_query.intersect(select(sq.c.game_id))

        res = await db.execute(base_query.limit(300))
        return [row[0] for row in res.all()]


analysis_service = AnalysisService()