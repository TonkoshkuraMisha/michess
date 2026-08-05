import time
import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import chess
import chess.pgn
import io

from src.db.session import get_db
from src.services.connection_manager import manager
from src.services.game_engine import engine
from src.services.game_state import state_manager
from src.api.deps import get_current_user_ws
from src.models.user import User

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

            if action == "join_queue":
                base_time = data.get("base_time_ms", 180000)
                inc_time = data.get("increment_ms", 0)

                default_min = max(0, current_user.rating - 150)
                default_max = current_user.rating + 150

                min_rating = data.get("min_rating", default_min)
                max_rating = data.get("max_rating", default_max)

                from src.services.matchmaker import matchmaker
                await matchmaker.join_queue(current_user.id, current_user.rating, base_time, inc_time, min_rating,
                                            max_rating)
                await manager.send_personal_message({"event": "queue_joined"}, current_user.id)

            elif action == "leave_queue":
                from src.services.matchmaker import matchmaker
                await matchmaker.leave_queue(current_user.id)
                await manager.send_personal_message({"event": "queue_left"}, current_user.id)

            elif action == "resign":
                game_id = data.get("game_id")
                if not game_id: continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress": continue

                white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                if current_user.id not in (white_id, black_id): continue

                game_result = "0-1" if current_user.id == white_id else "1-0"
                rating_updates = await state_manager.finish_game(db, game_id, game_result)

                game_over_payload = {
                    "event": "game_over",
                    "game_id": game_id,
                    "reason": "resignation",
                    "winner_id": black_id if current_user.id == white_id else white_id,
                    "result": game_result
                }
                game_over_payload.update(rating_updates)

                await manager.send_personal_message(game_over_payload, white_id)
                await manager.send_personal_message(game_over_payload, black_id)

            elif action == "offer_draw":
                game_id = data.get("game_id")
                if not game_id: continue
                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress": continue

                white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                if current_user.id not in (white_id, black_id): continue

                opponent_id = black_id if current_user.id == white_id else white_id
                await state_manager.update_game_state(game_id, {"draw_offer": str(current_user.id)})
                await manager.send_personal_message(
                    {"event": "draw_offered", "game_id": game_id, "player_id": current_user.id}, opponent_id)

            elif action == "accept_draw":
                game_id = data.get("game_id")
                if not game_id: continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress": continue

                white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                if current_user.id not in (white_id, black_id): continue

                draw_offer = game_state.get("draw_offer")
                if not draw_offer or int(draw_offer) == current_user.id:
                    await manager.send_personal_message({"event": "error", "message": "No active draw offer to accept"},
                                                        current_user.id)
                    continue

                game_result = "1/2-1/2"
                rating_updates = await state_manager.finish_game(db, game_id, game_result)

                game_over_payload = {
                    "event": "game_over",
                    "game_id": game_id,
                    "reason": "draw_agreement",
                    "result": game_result
                }
                game_over_payload.update(rating_updates)

                await manager.send_personal_message(game_over_payload, white_id)
                await manager.send_personal_message(game_over_payload, black_id)

            elif action == "decline_draw":
                game_id = data.get("game_id")
                if not game_id: continue

                game_state = await state_manager.get_game_state(game_id)
                if not game_state or game_state["status"] != "in_progress": continue

                white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                if current_user.id not in (white_id, black_id): continue

                opponent_id = black_id if current_user.id == white_id else white_id
                await state_manager.update_game_state(game_id, {"draw_offer": ""})
                await manager.send_personal_message(
                    {"event": "draw_declined", "game_id": game_id, "player_id": current_user.id}, opponent_id)

            elif action == "make_move":
                game_id, move_str = data.get("game_id"), data.get("move")
                if not game_id or not move_str: continue

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

                now_ms = int(time.time() * 1000)
                elapsed = now_ms - game_state["last_move_at"]
                increment = game_state["increment_ms"]
                new_white_time = game_state["white_time_ms"] - elapsed + increment if is_white_turn else game_state[
                    "white_time_ms"]
                new_black_time = game_state["black_time_ms"] - elapsed + increment if not is_white_turn else game_state[
                    "black_time_ms"]

                if is_white_turn and new_white_time <= 0:
                    game_result = "black_won_on_time"
                elif not is_white_turn and new_black_time <= 0:
                    game_result = "white_won_on_time"

                await state_manager.save_move_telemetry(game_id, {
                    "player_id": current_user.id,
                    "move_number": board.fullmove_number,
                    "notation": move_str,
                    "time_taken_ms": data.get("time_taken_ms", 0),
                    "window_blurred_before_move": data.get("window_blurred", False),
                    "is_premove": data.get("is_premove", False)
                })

                if game_result:
                    rating_updates = await state_manager.finish_game(db, game_id, game_result, final_pgn=new_pgn)
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

                if game_result:
                    move_payload.update(rating_updates)

                await manager.send_personal_message(move_payload, game_state["white_id"])
                await manager.send_personal_message(move_payload, game_state["black_id"])

    except WebSocketDisconnect:
        await manager.disconnect(current_user.id)