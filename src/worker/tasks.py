import asyncio
import logging
from celery import shared_task
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from stockfish import Stockfish
import chess.pgn
import io

from src.core.config import settings
from src.db.session import AsyncSessionLocal
from src.models.user import User
from src.models.game import Game
from src.models.move import Move

logger = logging.getLogger(__name__)


async def _process_anti_cheat_async(game_id: int):
    async with AsyncSessionLocal() as db:
        game = await db.get(Game, game_id)
        result = await db.execute(select(Move).where(Move.game_id == game_id))
        moves = result.scalars().all()

        if not game or not moves or len(moves) < 10:
            return

        # 1. Анализ клиентской телеметрии
        player_moves = {}
        for m in moves:
            player_moves.setdefault(m.player_id, []).append(m)

        suspicion_scores = {game.white_player_id: 0, game.black_player_id: 0}

        for player_id, p_moves in player_moves.items():
            blur_rate = sum(1 for m in p_moves if m.window_blurred_before_move) / len(p_moves)
            normal_moves = [m for m in p_moves if not m.is_premove]
            avg_time = sum(m.time_taken_ms for m in normal_moves) / len(normal_moves) if normal_moves else 0

            if blur_rate > settings.AC_BLUR_RATE_HIGH:
                suspicion_scores[player_id] += 20
            elif blur_rate > settings.AC_BLUR_RATE_MED:
                suspicion_scores[player_id] += 10

            if blur_rate > 0.3 and settings.AC_MIN_MOVE_TIME_MS <= avg_time <= settings.AC_MAX_MOVE_TIME_MS:
                suspicion_scores[player_id] += 15

        # 2. Анализ качества ходов через Stockfish (если есть базовые подозрения)
        if suspicion_scores[game.white_player_id] > 0 or suspicion_scores[game.black_player_id] > 0:
            try:
                sf = Stockfish(path=settings.AC_STOCKFISH_PATH, depth=15)
                pgn_io = io.StringIO(game.pgn)
                chess_game = chess.pgn.read_game(pgn_io)

                board = chess_game.board()
                sf.set_position([])  # Инициализация доски

                # В реальном проекте здесь вычисляется Average Centipawn Loss (ACPL)
                # Для примера проверяем совпадение с первой линией движка
                best_move_matches = {chess.WHITE: 0, chess.BLACK: 0}
                total_moves = {chess.WHITE: 0, chess.BLACK: 0}

                for move in chess_game.mainline_moves():
                    best_sf_move = sf.get_best_move()
                    if move.uci() == best_sf_move:
                        best_move_matches[board.turn] += 1

                    total_moves[board.turn] += 1
                    board.push(move)
                    sf.make_moves_from_current_position([move.uci()])

                # Если 80% ходов совпадают с первой линией движка на глубине 15 — это киборг
                white_accuracy = best_move_matches[chess.WHITE] / total_moves[chess.WHITE] if total_moves[
                    chess.WHITE] else 0
                black_accuracy = best_move_matches[chess.BLACK] / total_moves[chess.BLACK] if total_moves[
                    chess.BLACK] else 0

                if white_accuracy > 0.8: suspicion_scores[game.white_player_id] += 50
                if black_accuracy > 0.8: suspicion_scores[game.black_player_id] += 50

            except Exception as e:
                logger.error(f"Stockfish analysis failed: {e}")

        # 3. Применение санкций
        for player_id, penalty in suspicion_scores.items():
            if penalty > 0:
                user = await db.get(User, player_id)
                if user and not user.is_cheater:
                    user.trust_factor = max(0, user.trust_factor - penalty)
                    if user.trust_factor == 0:
                        user.is_cheater = True
                        logger.warning(f"🚨 [ANTI-CHEAT] Игрок {user.username} помечен как читер! Партия: {game_id}")
                    await db.commit()


@shared_task(name="analyze_game")
def analyze_game_task(game_id: int):
    """Синхронная обертка Celery для запуска асинхронного анализатора"""
    asyncio.run(_process_anti_cheat_async(game_id))
