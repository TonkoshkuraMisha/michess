import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages active WebSocket connections and a simple matchmaking queue.
    """

    def __init__(self):
        self.active_connections: dict[int, WebSocket] = {}
        self.waiting_players: list[int] = []

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info("User %s connected. Total active: %s", user_id, len(self.active_connections))

    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.waiting_players:
            self.waiting_players.remove(user_id)
        logger.info("User %s disconnected.", user_id)

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            websocket = self.active_connections[user_id]
            await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections.values():
            await connection.send_json(message)

    async def add_to_queue(self, user_id: int) -> tuple[int, int] | None:
        """
        Adds a user to the queue. If 2 players are waiting, pops them and returns their IDs.
        """
        if user_id not in self.waiting_players:
            self.waiting_players.append(user_id)
            logger.info("User %s joined matchmaking. Queue size: %s", user_id, len(self.waiting_players))

        if len(self.waiting_players) >= 2:
            player1_id = self.waiting_players.pop(0)
            player2_id = self.waiting_players.pop(0)
            logger.info("Match found! P1: %s vs P2: %s", player1_id, player2_id)
            return player1_id, player2_id

        return None


manager = ConnectionManager()