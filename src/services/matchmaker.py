import asyncio
import logging
import random
from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import User

logger = logging.getLogger(__name__)


class Matchmaker:
    """
    Менеджер открытых вызовов и очереди лобби.
    """

    def __init__(self):
        pass

    @property
    def redis(self):
        from src.db.redis import redis_client
        return redis_client

    async def join_queue(self, user_id: int, username: str, rating: int, base_time_ms: int, increment_ms: int,
                         min_rating: int, max_rating: int):
        queue_name = f"queue:{base_time_ms}:{increment_ms}"

        await self.redis.sadd("active_queues", queue_name)
        await self.redis.zadd(queue_name, {str(user_id): rating})

        prefs = {
            "user_id": user_id,
            "username": username,
            "rating": rating,
            "min_rating": min_rating,
            "max_rating": max_rating,
            "base_time_ms": base_time_ms,
            "increment_ms": increment_ms
        }
        await self.redis.hset(f"queue:prefs:{user_id}", mapping=prefs)
        logger.info("User %s (%s) published challenge in lobby", user_id, username)

    async def leave_queue(self, user_id: int):
        prefs = await self.redis.hgetall(f"queue:prefs:{user_id}")
        if prefs:
            queue_name = f"queue:{prefs['base_time_ms']}:{prefs['increment_ms']}"
            await self.redis.zrem(queue_name, str(user_id))
            await self.redis.delete(f"queue:prefs:{user_id}")
            logger.info("User %s left lobby queue", user_id)

    async def get_queue_players(self) -> list[dict]:
        """Возвращает список всех активных вызовов в лобби."""
        players = []
        active_queues = await self.redis.smembers("active_queues")
        for queue_name in active_queues:
            user_ids = await self.redis.zrange(queue_name, 0, -1)
            for u_id in user_ids:
                prefs = await self.redis.hgetall(f"queue:prefs:{u_id}")
                if prefs:
                    players.append({
                        "user_id": int(prefs.get("user_id", u_id)),
                        "username": prefs.get("username", "Игрок"),
                        "rating": int(prefs.get("rating", 1200)),
                        "base_time_ms": int(prefs.get("base_time_ms", 180000)),
                        "increment_ms": int(prefs.get("increment_ms", 0))
                    })
        return players

    async def accept_challenge(self, challenger_id: int, acceptor_id: int, connection_manager, state_manager):
        """Принятие вызова конкретного игрока из лобби с прямой верификацией из БД."""
        if challenger_id == acceptor_id:
            return None

        p1_prefs = await self.redis.hgetall(f"queue:prefs:{challenger_id}")
        if not p1_prefs:
            logger.warning("Challenge from %s no longer active", challenger_id)
            return None

        base_time = int(p1_prefs["base_time_ms"])
        inc_time = int(p1_prefs["increment_ms"])
        queue_name = f"queue:{base_time}:{inc_time}"

        # Убираем челенджера и акцептора из всех очередей
        await self.redis.zrem(queue_name, str(challenger_id), str(acceptor_id))
        await self.redis.delete(f"queue:prefs:{challenger_id}", f"queue:prefs:{acceptor_id}")

        async with AsyncSessionLocal() as db:
            u1_user = await db.get(User, challenger_id)
            u2_user = await db.get(User, acceptor_id)

            if not u1_user or not u2_user:
                return None

            active_queues = await self.redis.smembers("active_queues")
            for qn in active_queues:
                await self.redis.zrem(qn, str(acceptor_id), str(challenger_id))
            await self.redis.delete(f"queue:prefs:{acceptor_id}", f"queue:prefs:{challenger_id}")

            white_id, black_id = (u1_user.id, u2_user.id) if random.random() > 0.5 else (u2_user.id, u1_user.id)

            white_user = u1_user if white_id == u1_user.id else u2_user
            black_user = u1_user if black_id == u1_user.id else u2_user

            new_game = Game(
                white_player_id=white_user.id,
                black_player_id=black_user.id,
                base_time_ms=base_time,
                increment_ms=inc_time,
                status=GameStatus.IN_PROGRESS
            )
            db.add(new_game)
            await db.commit()
            await db.refresh(new_game)
            game_id = new_game.id

        await state_manager.initialize_game(
            game_id=game_id, white_id=white_user.id, black_id=black_user.id, base_time_ms=base_time,
            increment_ms=inc_time
        )

        match_payload = {
            "event": "match_found",
            "game_id": game_id,
            "white_username": white_user.username,
            "white_rating": white_user.rating,
            "black_username": black_user.username,
            "black_rating": black_user.rating
        }

        w_payload = {**match_payload, "color": "white", "opponent_id": black_user.id}
        b_payload = {**match_payload, "color": "black", "opponent_id": white_user.id}

        await connection_manager.send_personal_message(w_payload, white_user.id)
        await connection_manager.send_personal_message(b_payload, black_user.id)

        logger.info("Challenge accepted! Match created: White(%s) vs Black(%s) in game %s", white_user.id,
                    black_user.id, game_id)
        return game_id


matchmaker = Matchmaker()