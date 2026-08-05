import time
import json
from src.db.redis import redis_client


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
            "status": "in_progress"
        }
        await self.redis.hset(self._get_key(game_id), mapping=state)

    async def get_game_state(self, game_id: int) -> dict | None:
        state = await self.redis.hgetall(self._get_key(game_id))
        if not state:
            return None

        for key in ["white_id", "black_id", "white_time_ms", "black_time_ms", "increment_ms", "last_move_at"]:
            if key in state:
                state[key] = int(state[key])

        return state

    async def update_game_state(self, game_id: int, updates: dict):
        str_updates = {k: str(v) for k, v in updates.items()}
        await self.redis.hset(self._get_key(game_id), mapping=str_updates)

    async def clear_game_state(self, game_id: int):
        await self.redis.delete(self._get_key(game_id))

    async def save_move_telemetry(self, game_id: int, move_data: dict):
        key = f"game:{game_id}:moves"
        await self.redis.rpush(key, json.dumps(move_data))

    async def extract_all_moves(self, game_id: int) -> list[dict]:
        key = f"game:{game_id}:moves"
        moves_raw = await self.redis.lrange(key, 0, -1)
        await self.redis.delete(key)
        return [json.loads(m) for m in moves_raw]


state_manager = GameStateManager()