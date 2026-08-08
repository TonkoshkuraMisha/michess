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
    async def analyze_position(db: AsyncSession, moves: list[str]) -> dict:
        board = chess.Board()

        # 1. Воспроизводим ходы на доске
        for move_uci in moves:
            try:
                move = chess.Move.from_uci(move_uci)
                if move in board.legal_moves:
                    board.push(move)
                else:
                    break
            except ValueError:
                break

        current_fen = board.fen()

        # 2. Получаем оценку от Stockfish
        sf_evaluation = AnalysisService._get_stockfish_evaluation(current_fen)

        # 3. Получаем статистику продолжений (с проверкой Redis-кэша)
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

        # Шаг 1. Пытаемся достать данные из Redis
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            return json.loads(cached_data)

        # Шаг 2. Если в кэше нет, идем в PostgreSQL
        matching_game_ids = await AnalysisService._find_matching_games(db, moves)
        if not matching_game_ids:
            return []

        next_move_number = (len(moves) // 2) + 1

        query = select(
            Move.notation,
            func.count(Move.id).label("count")
        ).where(
            and_(
                Move.game_id.in_(matching_game_ids),
                Move.move_number == next_move_number
            )
        ).group_by(Move.notation).order_by(func.count(Move.id).desc()).limit(5)

        res = await db.execute(query)
        rows = res.all()

        total = sum(row.count for row in rows) if rows else 1

        result = [
            {
                "move": row.notation,
                "count": row.count,
                "frequency": round((row.count / total) * 100, 1)
            }
            for row in rows
        ]

        # Шаг 3. Сохраняем результат в Redis на 24 часа для ускорения будущих запросов
        if result:
            await redis_client.set(cache_key, json.dumps(result), ex=86400)

        return result

    @staticmethod
    async def _find_matching_games(db: AsyncSession, moves: list[str]) -> list[int]:
        if not moves:
            res = await db.execute(select(Game.id).where(Game.status == GameStatus.COMPLETED).limit(500))
            return [row[0] for row in res.all()]

        subqueries = []
        for idx, move_notation in enumerate(moves, start=1):
            subq = select(Move.game_id).where(
                and_(
                    Move.move_number == (idx + 1) // 2,
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