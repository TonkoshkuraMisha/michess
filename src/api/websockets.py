from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
import chess
import chess.pgn
import io

from src.db.session import get_db
from src.services.connection_manager import manager
from src.services.game_engine import engine
from src.api.deps import get_current_user_ws
from src.models.user import User
from src.models.game import Game, GameStatus
from src.models.move import Move

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSockets"])


@router.websocket("/matchmaking")
async def matchmaking_endpoint(
        websocket: WebSocket,
        current_user: User = Depends(get_current_user_ws),
        db: AsyncSession = Depends(get_db)
):
    """
    WebSocket endpoint for matchmaking, game actions, and telemetry.
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

            # --- 1. Поиск игры ---
            if action == "find_game":
                matched_players = await manager.add_to_queue(current_user.id)

                if matched_players:
                    white_id, black_id = matched_players

                    # Создаем активную игру в базе данных
                    new_game = Game(
                        white_player_id=white_id,
                        black_player_id=black_id,
                        status=GameStatus.IN_PROGRESS
                    )
                    db.add(new_game)
                    await db.commit()
                    await db.refresh(new_game)

                    # Уведомляем игроков
                    await manager.send_personal_message(
                        {"event": "match_found", "game_id": new_game.id, "color": "white", "opponent_id": black_id},
                        white_id
                    )
                    await manager.send_personal_message(
                        {"event": "match_found", "game_id": new_game.id, "color": "black", "opponent_id": white_id},
                        black_id
                    )
                else:
                    await manager.send_personal_message(
                        {"event": "waiting_for_opponent", "message": "In queue. Waiting for an opponent..."},
                        current_user.id
                    )

            # --- 2. Обработка хода ---
            elif action == "make_move":
                game_id = data.get("game_id")
                move_str = data.get("move")  # e.g., "e2e4"
                time_taken_ms = data.get("time_taken_ms", 0)
                window_blurred = data.get("window_blurred", False)
                is_premove = data.get("is_premove", False)

                if not game_id or not move_str:
                    await manager.send_personal_message(
                        {"event": "error", "message": "Missing game_id or move"},
                        current_user.id
                    )
                    continue

                # Находим игру в БД
                result = await db.execute(select(Game).where(Game.id == game_id))
                game = result.scalars().first()

                if not game or game.status != GameStatus.IN_PROGRESS:
                    await manager.send_personal_message(
                        {"event": "error", "message": "Game not found or inactive"},
                        current_user.id
                    )
                    continue

                # Проверяем, чей сейчас ход
                if game.pgn:
                    c_game = chess.pgn.read_game(io.StringIO(game.pgn))
                    board = c_game.end().board()
                else:
                    board = chess.Board()

                expected_player_id = game.white_player_id if board.turn == chess.WHITE else game.black_player_id

                if current_user.id != expected_player_id:
                    await manager.send_personal_message(
                        {"event": "error", "message": "Not your turn!"},
                        current_user.id
                    )
                    continue

                # Валидируем и делаем ход через движок
                is_valid, new_pgn, game_result = engine.process_move(game.pgn, move_str)

                if not is_valid:
                    await manager.send_personal_message(
                        {"event": "error", "message": f"Illegal move: {move_str}"},
                        current_user.id
                    )
                    continue

                # Ход валиден: обновляем запись партии
                game.pgn = new_pgn
                move_number = board.fullmove_number

                if game_result:
                    game.status = GameStatus.COMPLETED
                    game.finished_at = func.now()

                # Сохраняем ход и античит-телеметрию
                new_move = Move(
                    game_id=game.id,
                    player_id=current_user.id,
                    move_number=move_number,
                    notation=move_str,
                    time_taken_ms=time_taken_ms,
                    window_blurred_before_move=window_blurred,
                    is_premove=is_premove
                )
                db.add(new_move)
                await db.commit()

                # Формируем payload для рассылки
                move_payload = {
                    "event": "move_made",
                    "game_id": game.id,
                    "player_id": current_user.id,
                    "move": move_str,
                    "pgn": new_pgn,
                    "game_over": game_result is not None,
                    "result": game_result
                }

                # Отправляем обновленное состояние обоим игрокам
                await manager.send_personal_message(move_payload, game.white_player_id)
                await manager.send_personal_message(move_payload, game.black_player_id)

    except WebSocketDisconnect:
        manager.disconnect(current_user.id)