import time
import json
import asyncio
import logging
from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.move import Move
from sqlalchemy.sql import func

logger = logging.getLogger(__name__)


class GameStateManager:
    """
    Управляет состоянием активных шахматных партий и часами игроков в Redis.
    Обеспечивает микросекундный доступ к состоянию игры без нагрузки на PostgreSQL.
    """

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

    async def handle_player_disconnect(self, user_id: int, manager):
        """Фиксирует обрыв связи и запускает отсчет оффлайн-времени."""
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str:
            return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress":
            return

        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        now_ms = int(time.time() * 1000)
        updates = {
            f"{color}_disconnected": "true",
            f"{color}_disconnect_started_at": str(now_ms)
        }
        await self.update_game_state(game_id, updates)

        remaining_time = state["white_time_ms"] if color == "white" else state["black_time_ms"]
        max_wait_ms = min(remaining_time, 3 * 60 * 1000)

        logger.info("Player %s disconnected in game %s. Tracking offline time (max wait: %sms)", user_id, game_id,
                    max_wait_ms)

        await manager.send_personal_message({
            "event": "opponent_disconnected",
            "game_id": game_id,
            "max_wait_ms": max_wait_ms
        }, opponent_id)

    async def handle_player_reconnect(self, user_id: int, manager):
        """Обрабатывает переподключение: списывает оффлайн-время с часов игрока."""
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str:
            return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress":
            return

        white_id = int(state["white_id"])
        black_id = int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        if state.get(f"{color}_disconnected") == "true":
            now_ms = int(time.time() * 1000)
            disconnect_started = state.get(f"{color}_disconnect_started_at", now_ms)
            offline_duration = now_ms - disconnect_started

            updates = {
                f"{color}_disconnected": "false",
                f"{color}_disconnect_started_at": "0"
            }

            # Если был ход этого игрока, списываем время отсутствия с его часов
            turn = state["turn"]
            if turn == color:
                time_key = f"{color}_time_ms"
                new_time = max(0, state[time_key] - offline_duration)
                updates[time_key] = str(new_time)

            # Корректируем last_move_at, чтобы прошедшее оффлайн-время не учлось дважды
            updates["last_move_at"] = str(state["last_move_at"] + offline_duration)

            await self.update_game_state(game_id, updates)
            logger.info("Player %s reconnected in game %s. Offline duration %sms processed.", user_id, game_id,
                        offline_duration)

            await manager.send_personal_message({
                "event": "opponent_reconnected",
                "game_id": game_id
            }, opponent_id)

    async def check_timeouts_loop(self, manager):
        """Фоновый цикл проверки истечения времени на часах и лимитов дисконекта."""
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

                    white_id = int(state["white_id"])
                    black_id = int(state["black_id"])
                    turn = state["turn"]

                    game_result = None
                    winner_id = None
                    reason = "timeout"

                    # 1. Проверка дисконектов и их влияния на часы
                    for color in ["white", "black"]:
                        if state.get(f"{color}_disconnected") == "true":
                            disconnect_started = state.get(f"{color}_disconnect_started_at", now_ms)
                            offline_duration = now_ms - disconnect_started

                            remaining_time = state["white_time_ms"] if color == "white" else state["black_time_ms"]
                            current_player_time = remaining_time - offline_duration if turn == color else remaining_time
                            max_grace_ms = min(remaining_time, 3 * 60 * 1000)

                            if current_player_time <= 0 or offline_duration >= max_grace_ms:
                                game_result = "black_won_on_time" if color == "white" else "white_won_on_time"
                                winner_id = black_id if color == "white" else white_id
                                reason = "disconnect_timeout"
                                break

                    # 2. Обычная проверка шахматных часов для активных игроков
                    if not game_result:
                        elapsed = now_ms - state["last_move_at"]
                        if turn == "white" and state.get("white_disconnected") != "true":
                            if state["white_time_ms"] - elapsed <= 0:
                                game_result = "black_won_on_time"
                                winner_id = black_id
                        elif turn == "black" and state.get("black_disconnected") != "true":
                            if state["black_time_ms"] - elapsed <= 0:
                                game_result = "white_won_on_time"
                                winner_id = white_id

                    if game_result:
                        logger.info("Game %s ended. Result: %s, Reason: %s", game_id, game_result, reason)
                        async with AsyncSessionLocal() as db:
                            db_game = await db.get(Game, game_id)
                            if db_game and db_game.status == GameStatus.IN_PROGRESS:
                                db_game.status = GameStatus.COMPLETED
                                db_game.finished_at = func.now()

                                moves_telemetry = await self.extract_all_moves(game_id)
                                db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
                                db.add_all(db_moves)
                                await db.commit()

                        await self.clear_game_state(game_id)

                        game_over_payload = {
                            "event": "game_over",
                            "game_id": game_id,
                            "reason": reason,
                            "winner_id": winner_id,
                            "result": game_result
                        }
                        await manager.send_personal_message(game_over_payload, white_id)
                        await manager.send_personal_message(game_over_payload, black_id)

            except Exception as e:
                logger.error("Error in check_timeouts_loop: %s", e)

            await asyncio.sleep(0.5)


state_manager = GameStateManager()