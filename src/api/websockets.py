from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import logging
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.services.connection_manager import manager
from src.api.deps import get_current_user_ws
from src.models.user import User
from src.models.game import Game

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSockets"])


@router.websocket("/matchmaking")
async def matchmaking_endpoint(
        websocket: WebSocket,
        current_user: User = Depends(get_current_user_ws),
        db: AsyncSession = Depends(get_db)
):
    """
    WebSocket endpoint for matchmaking and player presence.
    Requires a valid JWT token in the query parameters.
    """
    await manager.connect(websocket, current_user.id)
    try:
        await manager.send_personal_message(
            {"event": "connected", "message": f"Welcome, {current_user.username}!"},
            current_user.id
        )

        while True:
            data = await websocket.receive_json()
            logger.info("Received from user %s: %s", current_user.id, data)

            action = data.get("action")

            if action == "find_game":
                matched_players = await manager.add_to_queue(current_user.id)

                if matched_players:
                    white_id, black_id = matched_players

                    # Создаем игру в базе данных
                    new_game = Game(white_player_id=white_id, black_player_id=black_id)
                    db.add(new_game)
                    await db.commit()
                    await db.refresh(new_game)

                    # Рассылаем информацию о матче обоим клиентам
                    await manager.send_personal_message(
                        {"event": "match_found", "game_id": new_game.id, "color": "white", "opponent_id": black_id},
                        white_id
                    )
                    await manager.send_personal_message(
                        {"event": "match_found", "game_id": new_game.id, "color": "black", "opponent_id": white_id},
                        black_id
                    )
                else:
                    # Игрок один, ждем второго
                    await manager.send_personal_message(
                        {"event": "waiting_for_opponent", "message": "In queue. Waiting for an opponent..."},
                        current_user.id
                    )

    except WebSocketDisconnect:
        manager.disconnect(current_user.id)