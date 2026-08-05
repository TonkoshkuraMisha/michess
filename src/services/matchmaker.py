import asyncio
import logging
import random
from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus

logger = logging.getLogger(__name__)


class Matchmaker:
    """
    Движок автоматического подбора игроков.
    Хранит очереди в Redis Sorted Sets для быстрого поиска по рейтингу.
    """

    def __init__(self):
        pass

    @property
    def redis(self):
        from src.db.redis import redis_client
        return redis_client

    async def join_queue(self, user_id: int, rating: int, base_time_ms: int, increment_ms: int, min_rating: int,
                         max_rating: int):
        queue_name = f"queue:{base_time_ms}:{increment_ms}"

        # Регистрируем активную очередь
        await self.redis.sadd("active_queues", queue_name)

        # Добавляем игрока в очередь (ZSET с весом = рейтинг)
        await self.redis.zadd(queue_name, {str(user_id): rating})

        # Сохраняем его настройки поиска
        prefs = {
            "rating": rating,
            "min_rating": min_rating,
            "max_rating": max_rating,
            "base_time_ms": base_time_ms,
            "increment_ms": increment_ms
        }
        await self.redis.hset(f"queue:prefs:{user_id}", mapping=prefs)
        logger.info("User %s joined %s (rating %s, target: %s-%s)", user_id, queue_name, rating, min_rating, max_rating)

    async def leave_queue(self, user_id: int):
        prefs = await self.redis.hgetall(f"queue:prefs:{user_id}")
        if prefs:
            queue_name = f"queue:{prefs['base_time_ms']}:{prefs['increment_ms']}"
            await self.redis.zrem(queue_name, str(user_id))
            await self.redis.delete(f"queue:prefs:{user_id}")
            logger.info("User %s left queue", user_id)

    async def matchmaking_loop(self, connection_manager, state_manager):
        """Фоновый процесс поиска оппонентов."""
        while True:
            try:
                active_queues = await self.redis.smembers("active_queues")
                for queue_name in active_queues:
                    # Достаем всех игроков в очереди, уже отсортированных по рейтингу
                    players = await self.redis.zrange(queue_name, 0, -1)
                    if len(players) < 2:
                        continue

                    matched = set()
                    for i in range(len(players)):
                        p1_id = players[i]
                        if p1_id in matched:
                            continue

                        p1_prefs = await self.redis.hgetall(f"queue:prefs:{p1_id}")
                        if not p1_prefs:
                            continue

                        p1_rating = int(p1_prefs["rating"])
                        p1_min = int(p1_prefs["min_rating"])
                        p1_max = int(p1_prefs["max_rating"])

                        # Собираем всех, с кем вилки рейтинга пересекаются взаимно
                        candidates = []
                        for j in range(i + 1, len(players)):
                            p2_id = players[j]
                            if p2_id in matched:
                                continue

                            p2_prefs = await self.redis.hgetall(f"queue:prefs:{p2_id}")
                            if not p2_prefs:
                                continue

                            p2_rating = int(p2_prefs["rating"])
                            p2_min = int(p2_prefs["min_rating"])
                            p2_max = int(p2_prefs["max_rating"])

                            # Проверяем, что P1 устраивает P2, а P2 устраивает P1
                            if (p2_min <= p1_rating <= p2_max) and (p1_min <= p2_rating <= p1_max):
                                candidates.append(p2_id)

                        if candidates:
                            # Выбираем случайного из подходящих
                            p2_id = random.choice(candidates)
                            matched.add(p1_id)
                            matched.add(p2_id)

                            await self._create_match(p1_id, p2_id, p1_prefs, connection_manager, state_manager,
                                                     queue_name)

            except Exception as e:
                logger.error("Matchmaking loop error: %s", e)

            # Такт поиска — 1 секунда
            await asyncio.sleep(1)

    async def _create_match(self, p1_id: str, p2_id: str, prefs: dict, connection_manager, state_manager,
                            queue_name: str):
        base_time = int(prefs["base_time_ms"])
        inc_time = int(prefs["increment_ms"])
        u1, u2 = int(p1_id), int(p2_id)

        # Случайное распределение цветов
        white_id, black_id = (u1, u2) if random.random() > 0.5 else (u2, u1)

        # Чистим очередь
        await self.redis.zrem(queue_name, p1_id, p2_id)
        await self.redis.delete(f"queue:prefs:{p1_id}", f"queue:prefs:{p2_id}")

        # Создаем запись в БД
        async with AsyncSessionLocal() as db:
            new_game = Game(
                white_player_id=white_id,
                black_player_id=black_id,
                base_time_ms=base_time,
                increment_ms=inc_time,
                status=GameStatus.IN_PROGRESS
            )
            db.add(new_game)
            await db.commit()
            await db.refresh(new_game)
            game_id = new_game.id

        # Инициализируем стейт игры
        await state_manager.initialize_game(
            game_id=game_id,
            white_id=white_id,
            black_id=black_id,
            base_time_ms=base_time,
            increment_ms=inc_time
        )

        # Оповещаем клиентов
        await connection_manager.send_personal_message(
            {"event": "match_found", "game_id": game_id, "color": "white", "opponent_id": black_id}, white_id
        )
        await connection_manager.send_personal_message(
            {"event": "match_found", "game_id": game_id, "color": "black", "opponent_id": white_id}, black_id
        )
        logger.info("Match created: %s vs %s in game %s", white_id, black_id, game_id)


matchmaker = Matchmaker()