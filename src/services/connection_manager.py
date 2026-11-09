# --- FILE: src/services/connection_manager.py ---

import asyncio
import json
import logging
from fastapi import WebSocket
from src.db.redis import redis_client

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Менеджер WebSocket-соединений с мгновенной прямой доставкой в активные сокеты
    и отказоустойчивым фоновым слушателем Redis Pub/Sub.
    """

    def __init__(self):
        self.game_spectators: dict[int, set[int]] = {}
        self.active_connections: dict[int, WebSocket] = {}
        self._user_sockets: dict[int, set[WebSocket]] = {}
        self.redis = redis_client
        self.pubsub = self.redis.pubsub()
        self._listener_task: asyncio.Task | None = None

    def _ensure_listener_running(self) -> None:
        if self._listener_task is None or self._listener_task.done():
            try:
                self._listener_task = asyncio.create_task(self._listen_pubsub())
            except RuntimeError:
                pass

    async def connect(self, websocket: WebSocket, user_id: int):
        uid = int(user_id)
        await websocket.accept()
        self.active_connections[uid] = websocket
        self._user_sockets.setdefault(uid, set()).add(websocket)

        try:
            await self.pubsub.subscribe(f"user:{uid}")
            self._ensure_listener_running()
        except Exception as exc:
            logger.warning("PubSub subscribe warning for user %s: %s", uid, exc)

        from src.services.game_state import state_manager
        await state_manager.handle_player_reconnect(uid, self)

        logger.info("User %s connected. Active users on worker: %s", uid, len(self.active_connections))

    async def disconnect(self, user_id: int, websocket: WebSocket | None = None):
        uid = int(user_id)
        sockets = self._user_sockets.get(uid)

        if sockets and websocket is not None:
            sockets.discard(websocket)
            if sockets:
                self.active_connections[uid] = next(iter(sockets))
                return

        self._user_sockets.pop(uid, None)
        self.active_connections.pop(uid, None)

        try:
            await self.pubsub.unsubscribe(f"user:{uid}")
        except Exception:
            pass

        from src.services.matchmaker import matchmaker
        await matchmaker.leave_queue(uid)

        from src.services.game_state import state_manager
        await state_manager.handle_player_disconnect(uid, self)

        logger.info("User %s disconnected.", uid)

    async def _deliver_local(self, user_id: int, raw_text: str) -> bool:
        """Мгновенно отправляет JSON во все открытые WebSocket-вкладки пользователя."""
        uid = int(user_id)
        sockets = list(self._user_sockets.get(uid, set()))
        if not sockets and uid in self.active_connections:
            sockets = [self.active_connections[uid]]

        delivered = False
        dead_sockets: list[WebSocket] = []

        for ws in sockets:
            try:
                await ws.send_text(raw_text)
                delivered = True
            except Exception:
                dead_sockets.append(ws)

        for dead_ws in dead_sockets:
            if uid in self._user_sockets:
                self._user_sockets[uid].discard(dead_ws)
            if self.active_connections.get(uid) is dead_ws:
                self.active_connections.pop(uid, None)

        return delivered

    async def _listen_pubsub(self):
        """Бесконечный цикл прослушивания Redis Pub/Sub (не завершается при пустых подписках)."""
        while True:
            try:
                if not getattr(self.pubsub, "subscribed", False):
                    await asyncio.sleep(0.25)
                    continue

                message = await self.pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    channel = str(message.get("channel", ""))
                    data = str(message.get("data", ""))
                    if channel.startswith("user:"):
                        uid = int(channel.split(":")[1])
                        await self._deliver_local(uid, data)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("PubSub listener loop warning: %s", e)
                await asyncio.sleep(0.5)

    async def send_personal_message(self, message: dict, user_id: int):
        """Доставляет сообщение напрямую в локальный WebSocket, а при отсутствии — через Redis Pub/Sub."""
        uid = int(user_id)
        payload_str = json.dumps(message)
        delivered_locally = await self._deliver_local(uid, payload_str)

        if not delivered_locally:
            try:
                await self.redis.publish(f"user:{uid}", payload_str)
            except Exception as exc:
                logger.error("Failed to publish message for user %s: %s", uid, exc)

    def add_spectator(self, game_id: int, user_id: int) -> None:
        self.game_spectators.setdefault(int(game_id), set()).add(int(user_id))

    def remove_spectator(self, game_id: int, user_id: int) -> None:
        gid = int(game_id)
        if gid in self.game_spectators:
            self.game_spectators[gid].discard(int(user_id))
            if not self.game_spectators[gid]:
                del self.game_spectators[gid]

    def remove_user_from_all_spectating(self, user_id: int) -> None:
        uid = int(user_id)
        empty_games = []
        for gid, watchers in self.game_spectators.items():
            watchers.discard(uid)
            if not watchers:
                empty_games.append(gid)
        for gid in empty_games:
            del self.game_spectators[gid]

    async def broadcast_to_spectators(self, game_id: int, message: dict) -> None:
        watchers = list(self.game_spectators.get(int(game_id), set()))
        for uid in watchers:
            await self.send_personal_message(message, uid)


manager = ConnectionManager()
