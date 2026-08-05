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

        await self.pubsub.subscribe(f"user:{user_id}")

        if self._listener_task is None:
            self._listener_task = asyncio.create_task(self._listen_pubsub())

        # Уведомляем менеджер состояния о переподключении игрока
        from src.services.game_state import state_manager
        await state_manager.handle_player_reconnect(user_id, self)

        logger.info("User %s connected. Active on this worker: %s", user_id, len(self.active_connections))

    async def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

        await self.pubsub.unsubscribe(f"user:{user_id}")

        # Снимаем игрока с поиска, если он там был
        from src.services.matchmaker import matchmaker
        await matchmaker.leave_queue(user_id)

        # Уведомляем менеджер состояния об обрыве связи (запуск Grace Period)
        from src.services.game_state import state_manager
        await state_manager.handle_player_disconnect(user_id, self)

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


manager = ConnectionManager()