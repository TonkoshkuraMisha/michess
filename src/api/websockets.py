# --- FILE: src/api/websockets.py ---

import time
import logging
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.services.connection_manager import manager
from src.services.game_state import state_manager
from src.api.deps import get_current_user_ws
from src.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSockets"])


async def _send_active_game_snapshot_if_exists(db: AsyncSession, user: User):
    """Если игрок переподключился во время идущей партии, восстанавливаем ему доску и часы."""
    game_id_str = await state_manager.redis.get(f"user:{user.id}:current_game")
    if not game_id_str:
        return

    game_id = int(game_id_str)
    state = await state_manager.get_game_state(game_id)
    if not state or state.get("status") != "in_progress":
        return

    white_id = int(state["white_id"])
    black_id = int(state["black_id"])
    white_user = await db.get(User, white_id)
    black_user = await db.get(User, black_id)

    now_ms = int(time.time() * 1000)
    elapsed = max(0, now_ms - int(state["last_move_at"]))
    turn = state.get("turn", "white")

    white_time = max(0, int(state["white_time_ms"]) - elapsed) if turn in ("white", "w") else int(
        state["white_time_ms"])
    black_time = max(0, int(state["black_time_ms"]) - elapsed) if turn in ("black", "b") else int(
        state["black_time_ms"])

    payload = {
        "event": "match_found",
        "game_id": game_id,
        "color": "white" if user.id == white_id else "black",
        "opponent_id": black_id if user.id == white_id else white_id,
        "white_username": white_user.username if white_user else "Белые",
        "white_rating": white_user.rating if white_user else 1200,
        "black_username": black_user.username if black_user else "Черные",
        "black_rating": black_user.rating if black_user else 1200,
        "base_time_ms": int(state.get("base_time_ms", 180000)),
        "increment_ms": int(state.get("increment_ms", 0)),
        "white_time_ms": white_time,
        "black_time_ms": black_time,
        "fen": state.get("board_fen"),
        "pgn": state.get("pgn", ""),
        "state_version": int(state.get("state_version", 0))
    }
    await manager.send_personal_message(payload, user.id)


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

        # Восстанавливаем партию, если игрок обновил страницу
        await _send_active_game_snapshot_if_exists(db, current_user)

        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            try:
                if action == "join_queue":
                    base_time = data.get("base_time_ms", 180000)
                    inc_time = data.get("increment_ms", 0)

                    default_min = max(0, current_user.rating - 150)
                    default_max = current_user.rating + 150

                    min_rating = data.get("min_rating", default_min)
                    max_rating = data.get("max_rating", default_max)

                    from src.services.matchmaker import matchmaker
                    await matchmaker.join_queue(
                        current_user.id, current_user.username, current_user.rating,
                        base_time, inc_time, min_rating, max_rating
                    )
                    await manager.send_personal_message({"event": "queue_joined"}, current_user.id)

                elif action == "leave_queue":
                    from src.services.matchmaker import matchmaker
                    await matchmaker.leave_queue(current_user.id)
                    await manager.send_personal_message({"event": "queue_left"}, current_user.id)

                elif action == "accept_challenge":
                    target_user_id = data.get("target_user_id")
                    if target_user_id and target_user_id != current_user.id:
                        from src.services.matchmaker import matchmaker
                        await matchmaker.accept_challenge(target_user_id, current_user.id, manager, state_manager)

                elif action == "resign":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state["status"] != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    game_result = "0-1" if current_user.id == white_id else "1-0"
                    rating_updates = await state_manager.finish_game(
                        db, game_id, game_result, termination="resignation"
                    )

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
                    if not game_id:
                        continue
                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state["status"] != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    opponent_id = black_id if current_user.id == white_id else white_id
                    await state_manager.update_game_state(game_id, {"draw_offer": str(current_user.id)})
                    await manager.send_personal_message(
                        {"event": "draw_offered", "game_id": game_id, "player_id": current_user.id},
                        opponent_id
                    )

                elif action == "accept_draw":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state["status"] != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    draw_offer = game_state.get("draw_offer")
                    if not draw_offer or int(draw_offer) == current_user.id:
                        await manager.send_personal_message(
                            {"event": "error", "message": "No active draw offer to accept"},
                            current_user.id
                        )
                        continue

                    game_result = "1/2-1/2"
                    rating_updates = await state_manager.finish_game(
                        db, game_id, game_result, termination="agreement"
                    )

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
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state["status"] != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    opponent_id = black_id if current_user.id == white_id else white_id
                    await state_manager.update_game_state(game_id, {"draw_offer": ""})
                    await manager.send_personal_message(
                        {"event": "draw_declined", "game_id": game_id, "player_id": current_user.id},
                        opponent_id
                    )

                elif action == "make_move":
                    game_id = data.get("game_id")
                    move_str = data.get("move")
                    command_id = data.get("command_id") or uuid.uuid4().hex
                    expected_version = data.get("state_version")

                    if not game_id or not move_str:
                        continue

                    res = await state_manager.process_atomic_move(
                        game_id=game_id,
                        user_id=current_user.id,
                        command_id=command_id,
                        move_str=move_str,
                        expected_version=expected_version
                    )

                    if res["status"] == "ignored":
                        continue

                    if res["status"] == "error":
                        await manager.send_personal_message(
                            {
                                "event": "error",
                                "message": res["reason"],
                                "fen": res.get("fen"),
                                "pgn": res.get("pgn"),
                                "state_version": res.get("state_version")
                            },
                            current_user.id
                        )
                        continue

                    white_id, black_id = res["white_id"], res["black_id"]
                    move_data = res.get("move_data")

                    if move_data:
                        # Для античита фиксируем серверное время elapsed_ms и сетевой лаг
                        server_elapsed_ms = res.get("elapsed_ms", 0)
                        client_time_ms = data.get("time_taken_ms", server_elapsed_ms)
                        network_lag_ms = max(0, server_elapsed_ms - int(client_time_ms))

                        await state_manager.save_move_telemetry(game_id, {
                            "player_id": current_user.id,
                            "move_number": move_data.get("fullmove_number", 1),
                            "notation": move_data.get("uci", move_str),
                            "san": move_data.get("san", move_str),
                            "fen_after": move_data.get("new_fen", ""),
                            "time_taken_ms": server_elapsed_ms,
                            "window_blurred_before_move": bool(data.get("window_blurred", False)),
                            "is_premove": bool(data.get("is_premove", False)),
                            "network_lag_ms": network_lag_ms
                        })

                        await state_manager.sync_authoritative_state_to_db(db, game_id, res)

                    if res["status"] == "game_over":
                        game_result = res["result"]
                        termination = res["termination"]
                        final_pgn = move_data["new_pgn"] if move_data else None

                        rating_updates = await state_manager.finish_game(
                            db, game_id, game_result, termination=termination, final_pgn=final_pgn
                        )

                        if move_data:
                            move_payload = {
                                "event": "move_made",
                                "game_id": game_id,
                                "player_id": current_user.id,
                                "command_id": command_id,
                                "state_version": res.get("state_version", 0),
                                "move": move_data["uci"],
                                "san": move_data["san"],
                                "fen": move_data["new_fen"],
                                "pgn": move_data["new_pgn"],
                                "white_time_ms": res["white_time_ms"],
                                "black_time_ms": res["black_time_ms"],
                                "game_over": True,
                                "result": game_result
                            }
                            move_payload.update(rating_updates)
                            await manager.send_personal_message(move_payload, white_id)
                            await manager.send_personal_message(move_payload, black_id)

                        game_over_payload = {
                            "event": "game_over",
                            "game_id": game_id,
                            "reason": termination,
                            "result": game_result,
                            "white_time_ms": res["white_time_ms"],
                            "black_time_ms": res["black_time_ms"]
                        }
                        game_over_payload.update(rating_updates)

                        await manager.send_personal_message(game_over_payload, white_id)
                        await manager.send_personal_message(game_over_payload, black_id)

                    elif res["status"] == "success":
                        move_payload = {
                            "event": "move_made",
                            "game_id": game_id,
                            "player_id": current_user.id,
                            "command_id": command_id,
                            "state_version": res["state_version"],
                            "move": move_data["uci"],
                            "san": move_data["san"],
                            "fen": move_data["new_fen"],
                            "pgn": move_data["new_pgn"],
                            "white_time_ms": res["white_time_ms"],
                            "black_time_ms": res["black_time_ms"],
                            "game_over": False
                        }

                        await manager.send_personal_message(move_payload, white_id)
                        await manager.send_personal_message(move_payload, black_id)

            except Exception as action_err:
                logger.error("Error processing WS action '%s' for user %s: %s", action, current_user.id, action_err)
                await manager.send_personal_message(
                    {"event": "error", "message": "Internal server error processing action"},
                    current_user.id
                )

    except WebSocketDisconnect:
        await manager.disconnect(current_user.id)
    except Exception as e:
        logger.error("WebSocket unexpected error for user %s: %s", current_user.id, e)
        await manager.disconnect(current_user.id)
