import time
import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.sql import func
import chess
import chess.pgn
import io

from src.db.session import get_db
from src.services.connection_manager import manager
from src.services.game_engine import engine
from src.services.game_state import state_manager
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
    await manager.connect(websocket, current_user.id)
    try:
        await manager.send_personal_message(
            {"event": "connected", "message": f"Welcome, {current_user.username}!"},
            current_user.id
        )

        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "get_seeks":
                seeks = await manager.get_all_seeks()
                await manager.send_personal_message({"event": "seeks_list", "seeks": seeks}, current_user.id)

            elif action == "create_seek":
                base_time = data.get("base_time_ms", 180000)
                inc_time = data.get("increment_ms", 0)
                await manager.create_seek(
                    user_id=current_user.id,
                    username=current_user.username,
                    rating=current_user.rating,
                    base_time_ms=base_time,
                    increment_ms=inc_time
                )
                await manager.send_personal_message({"event": "seek_created"}, current_user.id)

            elif action == "cancel_seek":
                await manager.remove_seek(current_user.id)
                await manager.send_personal_message({"event": "seek_canceled"}, current_user.id)

            elif action == "accept_seek":
                opponent_id = data.get("opponent_id")
                base_time = data.get("base_time_ms", 180000)
                inc_time = data.get("increment_ms", 0)

                if not opponent_id or opponent_id == current_user.id:
                    await manager.send_personal_message({"event": "error", "message": "Invalid opponent"},
                                                        current_user.id)
                    continue

                await manager.remove_seek(opponent_id)

                new_game = Game(
                    white_player_id=opponent_id,
                    black_player_id=current_user.id,
                    base_time_ms=base_time,
                    increment_ms=inc_time,
                    status=GameStatus.IN_PROGRESS
                )
                db.add(new_game)
                await db.commit()
                await db.refresh(new_game)

                await state_manager.initialize_game(
                    game_id=new_game.id,
                    white_id=opponent_id,
                    black_id=current_user.id,
                    base_time_ms=base_time,
                    increment_ms=inc_time
                )

                await manager.send_personal_message(
                    {"event": "match_found", "game_id": new_game.id, "color": "white", "opponent_id": current_user.id},
                    opponent_id
                )
                await manager.send_personal_message(
                    {"event": "match_found", "game_id": new_game.id, "color": "black", "opponent_id": opponent_id},
                    current_user.id
                )

            elif action == "resign":
                game_id = data.get("game_id")
                if not game_id:
                    continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress":
                    continue

                white_id = int(game_state["white_id"])
                black_id = int(game_state["black_id"])

                if current_user.id not in (white_id, black_id):
                    continue

                game_result = "0-1" if current_user.id == white_id else "1-0"

                db_game = await db.get(Game, game_id)
                if db_game:
                    db_game.status = GameStatus.COMPLETED
                    db_game.finished_at = func.now()

                    moves_telemetry = await state_manager.extract_all_moves(game_id)
                    db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
                    db.add_all(db_moves)
                    await db.commit()

                await state_manager.clear_game_state(game_id)

                game_over_payload = {
                    "event": "game_over",
                    "game_id": game_id,
                    "reason": "resignation",
                    "winner_id": black_id if current_user.id == white_id else white_id,
                    "result": game_result
                }

                await manager.send_personal_message(game_over_payload, white_id)
                await manager.send_personal_message(game_over_payload, black_id)

            elif action == "offer_draw":
                game_id = data.get("game_id")
                if not game_id:
                    continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress":
                    continue

                white_id = int(game_state["white_id"])
                black_id = int(game_state["black_id"])

                if current_user.id not in (white_id, black_id):
                    continue

                opponent_id = black_id if current_user.id == white_id else white_id
                await state_manager.update_game_state(game_id, {"draw_offer": str(current_user.id)})

                await manager.send_personal_message({
                    "event": "draw_offered",
                    "game_id": game_id,
                    "player_id": current_user.id
                }, opponent_id)

            elif action == "accept_draw":
                game_id = data.get("game_id")
                if not game_id:
                    continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress":
                    continue

                white_id = int(game_state["white_id"])
                black_id = int(game_state["black_id"])

                if current_user.id not in (white_id, black_id):
                    continue

                draw_offer = game_state.get("draw_offer")

                if not draw_offer or int(draw_offer) == current_user.id:
                    await manager.send_personal_message({"event": "error", "message": "No active draw offer to accept"},
                                                        current_user.id)
                    continue

                game_result = "1/2-1/2"

                db_game = await db.get(Game, game_id)
                if db_game:
                    db_game.status = GameStatus.COMPLETED
                    db_game.finished_at = func.now()

                    moves_telemetry = await state_manager.extract_all_moves(game_id)
                    db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
                    db.add_all(db_moves)
                    await db.commit()

                await state_manager.clear_game_state(game_id)

                game_over_payload = {
                    "event": "game_over",
                    "game_id": game_id,
                    "reason": "draw_agreement",
                    "result": game_result
                }

                await manager.send_personal_message(game_over_payload, white_id)
                await manager.send_personal_message(game_over_payload, black_id)

            elif action == "decline_draw":
                game_id = data.get("game_id")
                if not game_id:
                    continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress":
                    continue

                white_id = int(game_state["white_id"])
                black_id = int(game_state["black_id"])

                if current_user.id not in (white_id, black_id):
                    continue

                opponent_id = black_id if current_user.id == white_id else white_id
                await state_manager.update_game_state(game_id, {"draw_offer": ""})

                await manager.send_personal_message({
                    "event": "draw_declined",
                    "game_id": game_id,
                    "player_id": current_user.id
                }, opponent_id)

            elif action == "make_move":
                game_id = data.get("game_id")
                move_str = data.get("move")

                if not game_id or not move_str:
                    continue

                game_state = await state_manager.get_game_state(game_id)

                if not game_state or game_state["status"] != "in_progress":
                    await manager.send_personal_message({"event": "error", "message": "Game inactive or not found"},
                                                        current_user.id)
                    continue

                is_white_turn = game_state["turn"] == "white"
                expected_player_id = game_state["white_id"] if is_white_turn else game_state["black_id"]

                if current_user.id != expected_player_id:
                    await manager.send_personal_message({"event": "error", "message": "Not your turn!"},
                                                        current_user.id)
                    continue

                is_valid, new_pgn, game_result = engine.process_move(game_state["pgn"], move_str)

                if not is_valid:
                    await manager.send_personal_message({"event": "error", "message": f"Illegal move: {move_str}"},
                                                        current_user.id)
                    continue

                c_game = chess.pgn.read_game(io.StringIO(new_pgn))
                board = c_game.end().board()
                move_number = board.fullmove_number

                now_ms = int(time.time() * 1000)
                elapsed = now_ms - game_state["last_move_at"]
                increment = game_state["increment_ms"]

                new_white_time = game_state["white_time_ms"]
                new_black_time = game_state["black_time_ms"]

                if is_white_turn:
                    new_white_time = new_white_time - elapsed + increment
                    if new_white_time <= 0:
                        game_result = "black_won_on_time"
                else:
                    new_black_time = new_black_time - elapsed + increment
                    if new_black_time <= 0:
                        game_result = "white_won_on_time"

                time_taken_ms = data.get("time_taken_ms", 0)
                await state_manager.save_move_telemetry(game_id, {
                    "player_id": current_user.id,
                    "move_number": move_number,
                    "notation": move_str,
                    "time_taken_ms": time_taken_ms,
                    "window_blurred_before_move": data.get("window_blurred", False),
                    "is_premove": data.get("is_premove", False)
                })

                if game_result:
                    db_game = await db.get(Game, game_id)
                    if db_game:
                        db_game.pgn = new_pgn
                        db_game.status = GameStatus.COMPLETED
                        db_game.finished_at = func.now()

                        moves_telemetry = await state_manager.extract_all_moves(game_id)
                        db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
                        db.add_all(db_moves)

                        await db.commit()

                    await state_manager.clear_game_state(game_id)
                else:
                    await state_manager.update_game_state(game_id, {
                        "pgn": new_pgn,
                        "turn": "black" if is_white_turn else "white",
                        "last_move_at": now_ms,
                        "white_time_ms": new_white_time,
                        "black_time_ms": new_black_time
                    })

                move_payload = {
                    "event": "move_made",
                    "game_id": game_id,
                    "player_id": current_user.id,
                    "move": move_str,
                    "pgn": new_pgn,
                    "white_time_ms": new_white_time,
                    "black_time_ms": new_black_time,
                    "game_over": game_result is not None,
                    "result": game_result
                }

                await manager.send_personal_message(move_payload, game_state["white_id"])
                await manager.send_personal_message(move_payload, game_state["black_id"])

    except WebSocketDisconnect:
        await manager.disconnect(current_user.id)