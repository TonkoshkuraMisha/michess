import json
import asyncio
import logging
from fastapi import WebSocket
from src.db.redis import redis_client

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Scalable WebSocket manager powered by Redis Pub/Sub.
    Handles personal messages and global lobby broadcasts across multiple processes.
    """

    def __init__(self):
        self.active_connections: dict[int, WebSocket] = {}
        self.redis = redis_client
        self.pubsub = self.redis.pubsub()
        self._listener_task: asyncio.Task | None = None

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket

        # Подписываем воркер на персональный канал пользователя
        await self.pubsub.subscribe(f"user:{user_id}")

        # Запускаем фоновое прослушивание Pub/Sub
        if self._listener_task is None:
            self._listener_task = asyncio.create_task(self._listen_pubsub())

        logger.info("User %s connected. Active on this worker: %s", user_id, len(self.active_connections))

    async def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

        # Отписываемся от канала и удаляем вызов из лобби, если игрок отключился
        await self.pubsub.unsubscribe(f"user:{user_id}")
        await self.remove_seek(user_id)

        logger.info("User %s disconnected.", user_id)

    async def _listen_pubsub(self):
        """Фоновый таск, который слушает Redis Pub/Sub и прокидывает сообщения в нужные WebSocket-ы."""
        try:
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    data = message["data"]

                    if channel.startswith("user:"):
                        user_id = int(channel.split(":")[1])
                        if user_id in self.active_connections:
                            ws = self.active_connections[user_id]
                            await ws.send_text(data)
        except Exception as e:
            logger.error("PubSub listener error: %s", e)

    async def send_personal_message(self, message: dict, user_id: int):
        """Отправляет сообщение пользователю через Redis."""
        await self.redis.publish(f"user:{user_id}", json.dumps(message))

    # --- LOBBY (SEEKS) MANAGEMENT ---

    async def create_seek(self, user_id: int, username: str, rating: int, base_time_ms: int, increment_ms: int):
        """Создает новый вызов на доске объявлений (Redis Hash)."""
        seek_data = {
            "user_id": user_id,
            "username": username,
            "rating": rating,
            "base_time_ms": base_time_ms,
            "increment_ms": increment_ms
        }
        await self.redis.hset("lobby:seeks", str(user_id), json.dumps(seek_data))
        logger.info("Seek created for user %s: %s+%s", user_id, base_time_ms, increment_ms)

    async def remove_seek(self, user_id: int):
        """Удаляет вызов с доски."""
        await self.redis.hdel("lobby:seeks", str(user_id))
        logger.info("Seek removed for user %s", user_id)

    async def get_all_seeks(self) -> list[dict]:
        """Возвращает все текущие вызовы."""
        seeks_raw = await self.redis.hgetall("lobby:seeks")
        return [json.loads(seek) for seek in seeks_raw.values()]


manager = ConnectionManager()