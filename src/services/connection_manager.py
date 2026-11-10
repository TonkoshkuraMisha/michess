# --- FILE: src/services/connection_manager.py ---
"""
Менеджер WebSocket-соединений, корректный при нескольких воркерах (процессах) и вкладках.

Состояние, которое должно быть общим для всех воркеров, хранится в Redis:
- присутствие: каждое соединение — элемент sorted set `presence:user:{uid}` с отметкой
  последнего пульса. Игрок считается офлайн, только когда живых соединений нет ни на одном
  воркере; записи упавшего воркера устаревают через PRESENCE_STALE_MS;
- зрители партий: `game:{gid}:spectators` и обратный индекс `user:{uid}:spectating`.

Доставка: сообщение сразу отправляется в локальные сокеты пользователя и всегда публикуется
в канал `user:{uid}` с id воркера-отправителя. Остальные воркеры доставляют его в свои
вкладки этого пользователя, отправитель своё сообщение пропускает (без дублей).
"""

import asyncio
import json
import logging
import time
import uuid

from fastapi import WebSocket

from src.core.instance import WORKER_ID
from src.db.redis import redis_client

logger = logging.getLogger(__name__)

PRESENCE_HEARTBEAT_S = 10
PRESENCE_STALE_MS = 35_000
SPECTATING_TTL_S = 6 * 60 * 60


def _presence_key(uid: int) -> str:
    return f"presence:user:{uid}"


def _spectators_key(gid: int) -> str:
    return f"game:{gid}:spectators"


def _spectating_key(uid: int) -> str:
    return f"user:{uid}:spectating"


def _now_ms() -> int:
    return int(time.time() * 1000)


class ConnectionManager:
    def __init__(self):
        self.worker_id = WORKER_ID
        self.active_connections: dict[int, WebSocket] = {}
        self._user_sockets: dict[int, set[WebSocket]] = {}
        # websocket -> (user_id, connection_id в Redis-присутствии)
        self._connections: dict[WebSocket, tuple[int, str]] = {}
        self.redis = redis_client
        self.pubsub = self.redis.pubsub()
        self._listener_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None

    # ------------------------------------------------------------------ фоновые задачи

    def _ensure_background_tasks(self) -> None:
        try:
            if self._listener_task is None or self._listener_task.done():
                self._listener_task = asyncio.create_task(self._listen_pubsub())
            if self._heartbeat_task is None or self._heartbeat_task.done():
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        except RuntimeError:
            pass

    async def _heartbeat_loop(self):
        """Обновляет отметки присутствия всех локальных соединений, пока они открыты."""
        while True:
            try:
                await asyncio.sleep(PRESENCE_HEARTBEAT_S)
                now = _now_ms()
                for uid, conn_id in list(self._connections.values()):
                    await self.redis.zadd(_presence_key(uid), {conn_id: now})
                    await self.redis.expire(_presence_key(uid), PRESENCE_STALE_MS // 1000 * 2)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Presence heartbeat failed: %s", exc)

    async def _listen_pubsub(self):
        """Доставляет в локальные сокеты сообщения, опубликованные другими воркерами."""
        while True:
            try:
                if not getattr(self.pubsub, "subscribed", False):
                    await asyncio.sleep(0.25)
                    continue

                message = await self.pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not message or message.get("type") != "message":
                    continue
                channel = str(message.get("channel", ""))
                if not channel.startswith("user:"):
                    continue
                raw = self._unwrap_envelope(str(message.get("data", "")))
                if raw is not None:
                    await self._deliver_local(int(channel.split(":")[1]), raw)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("PubSub listener loop warning: %s", e)
                await asyncio.sleep(0.5)

    def _unwrap_envelope(self, data: str) -> str | None:
        """Возвращает полезную нагрузку или None, если сообщение опубликовал этот же воркер."""
        try:
            envelope = json.loads(data)
        except ValueError:
            return data
        if isinstance(envelope, dict) and "origin" in envelope and "data" in envelope:
            if envelope["origin"] == self.worker_id:
                return None
            return str(envelope["data"])
        return data

    # ------------------------------------------------------------------ присутствие

    def _has_open_sockets(self, uid: int) -> bool:
        return bool(self._user_sockets.get(uid))

    async def _presence_add(self, uid: int, conn_id: str) -> None:
        try:
            await self.redis.zadd(_presence_key(uid), {conn_id: _now_ms()})
            await self.redis.expire(_presence_key(uid), PRESENCE_STALE_MS // 1000 * 2)
        except Exception as exc:
            logger.warning("Presence add failed for user %s: %s", uid, exc)

    async def _presence_remove(self, uid: int, conn_id: str) -> None:
        try:
            await self.redis.zrem(_presence_key(uid), conn_id)
        except Exception as exc:
            logger.warning("Presence remove failed for user %s: %s", uid, exc)

    async def is_user_online(self, user_id: int) -> bool:
        """Есть ли у пользователя живое соединение на любом воркере."""
        uid = int(user_id)
        if self._has_open_sockets(uid):
            return True
        try:
            key = _presence_key(uid)
            await self.redis.zremrangebyscore(key, 0, _now_ms() - PRESENCE_STALE_MS)
            return int(await self.redis.zcard(key)) > 0
        except Exception as exc:
            logger.warning("Presence check failed for user %s: %s", uid, exc)
            return False

    # ------------------------------------------------------------------ соединения

    async def connect(self, websocket: WebSocket, user_id: int):
        uid = int(user_id)
        await websocket.accept()
        conn_id = uuid.uuid4().hex
        self._connections[websocket] = (uid, conn_id)
        self.active_connections[uid] = websocket
        self._user_sockets.setdefault(uid, set()).add(websocket)
        await self._presence_add(uid, conn_id)

        try:
            await self.pubsub.subscribe(f"user:{uid}")
        except Exception as exc:
            logger.warning("PubSub subscribe warning for user %s: %s", uid, exc)
        self._ensure_background_tasks()

        from src.services.game_state import state_manager
        await state_manager.handle_player_reconnect(uid, self)

        logger.info("User %s connected. Active users on worker: %s", uid, len(self.active_connections))

    async def disconnect(self, user_id: int, websocket: WebSocket | None = None):
        """
        Закрывает одно соединение пользователя. Пока у него открыта хотя бы одна вкладка на
        любом воркере, он считается онлайн: очередь, зрительство и партия не затрагиваются.
        websocket=None закрывает все локальные соединения пользователя.

        Между await-ами пользователь может переподключиться (перезагрузка страницы, в том числе
        на другой воркер), поэтому присутствие перепроверяется. Новое соединение сначала
        регистрируется в Redis и только потом вызывает handle_player_reconnect, поэтому при
        любом порядке событий флаг отключения либо не ставится, либо снимается.
        """
        uid = int(user_id)

        closing = list(self._user_sockets.pop(uid, set())) if websocket is None else [websocket]
        for ws in closing:
            sockets = self._user_sockets.get(uid)
            if sockets is not None:
                sockets.discard(ws)
            conn = self._connections.pop(ws, None)
            if conn is not None:
                await self._presence_remove(uid, conn[1])

        if self._has_open_sockets(uid):
            self.active_connections[uid] = next(iter(self._user_sockets[uid]))
            return

        self._user_sockets.pop(uid, None)
        self.active_connections.pop(uid, None)

        try:
            await self.pubsub.unsubscribe(f"user:{uid}")
        except Exception:
            pass

        if self._has_open_sockets(uid):
            # Переподключился на этом воркере во время отписки — восстанавливаем подписку.
            try:
                await self.pubsub.subscribe(f"user:{uid}")
            except Exception as exc:
                logger.warning("PubSub resubscribe warning for user %s: %s", uid, exc)
            return

        if await self.is_user_online(uid):
            return  # открыта вкладка на другом воркере

        await self.remove_user_from_all_spectating(uid)

        from src.services.matchmaker import matchmaker
        await matchmaker.leave_queue(uid)

        if await self.is_user_online(uid):
            return

        from src.services.game_state import state_manager
        await state_manager.handle_player_disconnect(uid, self)

        if await self.is_user_online(uid):
            await state_manager.handle_player_reconnect(uid, self)
            return

        logger.info("User %s disconnected.", uid)

    # ------------------------------------------------------------------ доставка

    async def _deliver_local(self, user_id: int, raw_text: str) -> bool:
        """Мгновенно отправляет JSON во все открытые на этом воркере вкладки пользователя."""
        uid = int(user_id)
        sockets = list(self._user_sockets.get(uid, set()))

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

    async def send_personal_message(self, message: dict, user_id: int):
        """
        Доставляет сообщение во вкладки пользователя на этом воркере и публикует его для
        остальных воркеров (у пользователя могут быть вкладки на нескольких процессах).
        """
        uid = int(user_id)
        payload_str = json.dumps(message)
        await self._deliver_local(uid, payload_str)

        envelope = json.dumps({"origin": self.worker_id, "data": payload_str})
        try:
            await self.redis.publish(f"user:{uid}", envelope)
        except Exception as exc:
            logger.error("Failed to publish message for user %s: %s", uid, exc)

    # ------------------------------------------------------------------ зрители

    async def add_spectator(self, game_id: int, user_id: int) -> None:
        gid, uid = int(game_id), int(user_id)
        await self.remove_user_from_all_spectating(uid)
        await self.redis.sadd(_spectators_key(gid), str(uid))
        await self.redis.expire(_spectators_key(gid), SPECTATING_TTL_S)
        await self.redis.set(_spectating_key(uid), str(gid), ex=SPECTATING_TTL_S)

    async def remove_spectator(self, game_id: int, user_id: int) -> None:
        gid, uid = int(game_id), int(user_id)
        await self.redis.srem(_spectators_key(gid), str(uid))
        if await self.redis.get(_spectating_key(uid)) == str(gid):
            await self.redis.delete(_spectating_key(uid))

    async def remove_user_from_all_spectating(self, user_id: int) -> None:
        uid = int(user_id)
        gid = await self.redis.get(_spectating_key(uid))
        if gid:
            await self.redis.srem(_spectators_key(int(gid)), str(uid))
            await self.redis.delete(_spectating_key(uid))

    async def get_spectator_ids(self, game_id: int) -> set[int]:
        members = await self.redis.smembers(_spectators_key(int(game_id)))
        return {int(m) for m in members}

    async def broadcast_to_spectators(self, game_id: int, message: dict) -> None:
        for uid in await self.get_spectator_ids(game_id):
            await self.send_personal_message(message, uid)


manager = ConnectionManager()
