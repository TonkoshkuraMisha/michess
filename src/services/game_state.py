import time
import json
import asyncio
import logging
from sqlalchemy.sql import func
from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.models.user import User
from src.services.rating import elo_calculator

logger = logging.getLogger(__name__)


class GameStateManager:
    def __init__(self):
        self.redis = redis_client

    def _get_key(self, game_id: int) -> str:
        return f"game:{game_id}:state"

    async def initialize_game(self, game_id: int, white_id: int, black_id: int, base_time_ms: int, increment_ms: int):
        now_ms = int(time.time() * 1000)
        state = {
            "white_id": str(white_id),
            "black_id": str(black_id),
            "pgn": "",
            "white_time_ms": str(base_time_ms),
            "black_time_ms": str(base_time_ms),
            "increment_ms": str(increment_ms),
            "last_move_at": str(now_ms),
            "turn": "white",
            "status": "in_progress",
            "white_disconnected": "false",
            "black_disconnected": "false",
            "white_disconnect_started_at": "0",
            "black_disconnect_started_at": "0"
        }
        await self.redis.hset(self._get_key(game_id), mapping=state)
        await self.redis.sadd("active_games", str(game_id))
        await self.redis.set(f"user:{white_id}:current_game", str(game_id))
        await self.redis.set(f"user:{black_id}:current_game", str(game_id))

    async def get_game_state(self, game_id: int) -> dict | None:
        state = await self.redis.hgetall(self._get_key(game_id))
        if not state:
            return None
        for key in ["white_id", "black_id", "white_time_ms", "black_time_ms", "increment_ms", "last_move_at",
                    "white_disconnect_started_at", "black_disconnect_started_at"]:
            if key in state:
                state[key] = int(state[key])
        return state

    async def update_game_state(self, game_id: int, updates: dict):
        str_updates = {k: str(v) for k, v in updates.items()}
        await self.redis.hset(self._get_key(game_id), mapping=str_updates)

    async def clear_game_state(self, game_id: int):
        state = await self.get_game_state(game_id)
        if state:
            await self.redis.delete(f"user:{state['white_id']}:current_game")
            await self.redis.delete(f"user:{state['black_id']}:current_game")
        await self.redis.delete(self._get_key(game_id))
        await self.redis.srem("active_games", str(game_id))

    async def save_move_telemetry(self, game_id: int, move_data: dict):
        key = f"game:{game_id}:moves"
        await self.redis.rpush(key, json.dumps(move_data))

    async def extract_all_moves(self, game_id: int) -> list[dict]:
        key = f"game:{game_id}:moves"
        moves_raw = await self.redis.lrange(key, 0, -1)
        await self.redis.delete(key)
        return [json.loads(m) for m in moves_raw]

    async def finish_game(self, db, game_id: int, result: str, final_pgn: str = None) -> dict:
        """
        Единая точка завершения партии: сохраняет статусы, пересчитывает Эло и фиксирует мувы.
        """
        db_game = await db.get(Game, game_id)
        if not db_game:
            return {}

        white_user = await db.get(User, db_game.white_player_id)
        black_user = await db.get(User, db_game.black_player_id)

        delta_w = delta_b = 0
        new_w = white_user.rating
        new_b = black_user.rating

        if db_game.is_rated:
            new_w, delta_w, new_b, delta_b = elo_calculator.calculate_new_ratings(
                white_user.rating, black_user.rating, result
            )
            white_user.rating = new_w
            black_user.rating = new_b

        if final_pgn:
            db_game.pgn = final_pgn

        db_game.status = GameStatus.COMPLETED
        db_game.finished_at = func.now()

        moves_telemetry = await self.extract_all_moves(game_id)
        if moves_telemetry:
            db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
            db.add_all(db_moves)

        await db.commit()
        await self.clear_game_state(game_id)

        return {
            "white_delta": delta_w,
            "black_delta": delta_b,
            "white_new_rating": new_w,
            "black_new_rating": new_b
        }

    async def handle_player_disconnect(self, user_id: int, manager):
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str: return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress": return

        white_id, black_id = int(state["white_id"]), int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        now_ms = int(time.time() * 1000)
        await self.update_game_state(game_id, {
            f"{color}_disconnected": "true",
            f"{color}_disconnect_started_at": str(now_ms)
        })

        remaining_time = state["white_time_ms"] if color == "white" else state["black_time_ms"]
        max_wait_ms = min(remaining_time, 3 * 60 * 1000)
        await manager.send_personal_message(
            {"event": "opponent_disconnected", "game_id": game_id, "max_wait_ms": max_wait_ms}, opponent_id)

    async def handle_player_reconnect(self, user_id: int, manager):
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str: return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress": return

        white_id, black_id = int(state["white_id"]), int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        if state.get(f"{color}_disconnected") == "true":
            now_ms = int(time.time() * 1000)
            offline_duration = now_ms - state.get(f"{color}_disconnect_started_at", now_ms)
            updates = {f"{color}_disconnected": "false", f"{color}_disconnect_started_at": "0"}

            if state["turn"] == color:
                time_key = f"{color}_time_ms"
                updates[time_key] = str(max(0, state[time_key] - offline_duration))
            updates["last_move_at"] = str(state["last_move_at"] + offline_duration)

            await self.update_game_state(game_id, updates)
            await manager.send_personal_message({"event": "opponent_reconnected", "game_id": game_id}, opponent_id)

    async def check_timeouts_loop(self, manager):
        while True:
            try:
                active_game_ids = await self.redis.smembers("active_games")
                now_ms = int(time.time() * 1000)

                for game_id_str in active_game_ids:
                    game_id = int(game_id_str)
                    state = await self.get_game_state(game_id)
                    if not state or state["status"] != "in_progress":
                        await self.redis.srem("active_games", game_id_str)
                        continue

                    white_id, black_id, turn = int(state["white_id"]), int(state["black_id"]), state["turn"]
                    game_result, winner_id, reason = None, None, "timeout"

                    for color in ["white", "black"]:
                        if state.get(f"{color}_disconnected") == "true":
                            offline_duration = now_ms - state.get(f"{color}_disconnect_started_at", now_ms)
                            remaining_time = state["white_time_ms"] if color == "white" else state["black_time_ms"]
                            current_player_time = remaining_time - offline_duration if turn == color else remaining_time

                            if current_player_time <= 0 or offline_duration >= min(remaining_time, 3 * 60 * 1000):
                                game_result = "black_won_on_time" if color == "white" else "white_won_on_time"
                                winner_id = black_id if color == "white" else white_id
                                reason = "disconnect_timeout"
                                break

                    if not game_result:
                        elapsed = now_ms - state["last_move_at"]
                        if turn == "white" and state.get("white_disconnected") != "true" and (
                                state["white_time_ms"] - elapsed <= 0):
                            game_result, winner_id = "black_won_on_time", black_id
                        elif turn == "black" and state.get("black_disconnected") != "true" and (
                                state["black_time_ms"] - elapsed <= 0):
                            game_result, winner_id = "white_won_on_time", white_id

                    if game_result:
                        logger.info("Game %s ended. Result: %s, Reason: %s", game_id, game_result, reason)

                        async with AsyncSessionLocal() as db:
                            rating_updates = await self.finish_game(db, game_id, game_result)

                        game_over_payload = {
                            "event": "game_over",
                            "game_id": game_id,
                            "reason": reason,
                            "winner_id": winner_id,
                            "result": game_result
                        }
                        game_over_payload.update(rating_updates)

                        await manager.send_personal_message(game_over_payload, white_id)
                        await manager.send_personal_message(game_over_payload, black_id)

            except Exception as e:
                logger.error("Error in check_timeouts_loop: %s", e)

            await asyncio.sleep(0.5)


state_manager = GameStateManager()