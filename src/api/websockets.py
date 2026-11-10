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
from src.services.matchmaker import MatchmakingError, matchmaker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSockets"])


def _compute_live_clocks(state: dict) -> tuple[int, int]:
    now_ms = int(time.time() * 1000)
    elapsed = max(0, now_ms - int(state.get("last_move_at", now_ms)))
    turn = state.get("turn", "white")
    w_ms = int(state.get("white_time_ms", 180000))
    b_ms = int(state.get("black_time_ms", 180000))

    white_time = max(0, w_ms - elapsed) if turn in ("white", "w") else w_ms
    black_time = max(0, b_ms - elapsed) if turn in ("black", "b") else b_ms
    return white_time, black_time


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
    white_time, black_time = _compute_live_clocks(state)

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
        "state_version": int(state.get("state_version", 0)),
    }
    await manager.send_personal_message(payload, user.id)


async def create_rematch_game(db: AsyncSession, prev_state: dict, connection_manager=None) -> dict:
    """
    Создаёт партию-реванш со сменой цветов (white_id <-> black_id) и тем же контролем времени.
    Проверки занятости игроков и старт партии — в matchmaker.start_pvp_game.
    """
    return await matchmaker.start_pvp_game(
        white_id=int(prev_state["black_id"]),
        black_id=int(prev_state["white_id"]),
        base_time_ms=int(prev_state.get("base_time_ms", 180000)),
        increment_ms=int(prev_state.get("increment_ms", 0)),
        connection_manager=connection_manager,
        db=db,
    )


async def _fresh_current_user(db: AsyncSession, user: User) -> User:
    """
    WebSocket-сессия живёт всё соединение (expire_on_commit=False), и объект пользователя в ней
    не видит изменения рейтинга после сыгранных партий — перечитываем его из БД.
    """
    return await db.get(User, user.id, populate_existing=True) or user


async def broadcast_to_game_participants_and_spectators(
        game_id: int,
        white_id: int,
        black_id: int,
        payload: dict,
) -> None:
    """Отправляет событие обоим игрокам и всем зрителям, наблюдающим за партией."""
    await manager.send_personal_message(payload, white_id)
    await manager.send_personal_message(payload, black_id)
    await manager.broadcast_to_spectators(game_id, payload)


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

        await _send_active_game_snapshot_if_exists(db, current_user)

        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            try:
                if action == "join_queue":
                    fresh_user = await _fresh_current_user(db, current_user)
                    matched_game_id = await matchmaker.join_queue(
                        fresh_user.id, fresh_user.username, fresh_user.rating,
                        int(data.get("base_time_ms", 180000)),
                        int(data.get("increment_ms", 0)),
                        min_rating=data.get("min_rating"),
                        max_rating=data.get("max_rating"),
                        db=db,
                    )
                    if matched_game_id is None:
                        await manager.send_personal_message({"event": "queue_joined"}, current_user.id)

                elif action == "leave_queue":
                    await matchmaker.leave_queue(current_user.id)
                    await manager.send_personal_message({"event": "queue_left"}, current_user.id)

                elif action == "accept_challenge":
                    target_user_id = data.get("target_user_id")
                    if target_user_id:
                        await matchmaker.accept_challenge(
                            int(target_user_id), current_user.id, manager, state_manager, db=db,
                        )

                elif action == "create_invite":
                    base_time = int(data.get("base_time_ms", 180000))
                    inc_time = int(data.get("increment_ms", 2000))
                    color_pref = str(data.get("color_pref", "random"))

                    fresh_user = await _fresh_current_user(db, current_user)
                    invite_data = await matchmaker.create_private_invite(
                        user_id=fresh_user.id,
                        username=fresh_user.username,
                        rating=fresh_user.rating,
                        base_time_ms=base_time,
                        increment_ms=inc_time,
                        color_pref=color_pref,
                    )
                    await manager.send_personal_message(
                        {"event": "invite_created", **invite_data},
                        current_user.id,
                    )

                elif action == "accept_invite":
                    code = str(data.get("code", "")).strip()
                    if not code:
                        continue

                    await matchmaker.start_game_from_invite(code, current_user.id, manager, db=db)

                elif action == "spectate_game":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    gid = int(game_id)
                    state = await state_manager.get_game_state(gid)
                    if not state or state.get("status") != "in_progress":
                        await manager.send_personal_message(
                            {"event": "error", "message": "Партия уже завершена или не найдена"},
                            current_user.id,
                        )
                        continue

                    await manager.add_spectator(gid, current_user.id)

                    white_id = int(state["white_id"])
                    black_id = int(state["black_id"])
                    white_user = await db.get(User, white_id)
                    black_user = await db.get(User, black_id)
                    white_time, black_time = _compute_live_clocks(state)

                    await manager.send_personal_message({
                        "event": "spectate_started",
                        "game_id": gid,
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
                        "state_version": int(state.get("state_version", 0)),
                    }, current_user.id)

                elif action == "leave_spectate":
                    game_id = data.get("game_id")
                    if game_id:
                        await manager.remove_spectator(int(game_id), current_user.id)
                    else:
                        await manager.remove_user_from_all_spectating(current_user.id)
                    await manager.send_personal_message({"event": "spectate_left"}, current_user.id)

                elif action == "chat_message":
                    game_id = data.get("game_id")
                    raw_text = str(data.get("text", "")).strip()
                    if not game_id or not raw_text:
                        continue

                    clean_text = raw_text[:140]
                    gid = int(game_id)
                    game_state = await state_manager.get_game_state(gid)
                    if not game_state:
                        continue

                    white_id = int(game_state["white_id"])
                    black_id = int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        # Писать в чат партии могут только игроки: зрители (и кто угодно,
                        # знающий id партии) не должны спамить или подсказывать ходы.
                        await manager.send_personal_message(
                            {"event": "error", "code": "chat_forbidden",
                             "message": "Писать в чат партии могут только её участники"},
                            current_user.id,
                        )
                        continue

                    chat_payload = {
                        "event": "chat_message",
                        "game_id": gid,
                        "sender_id": current_user.id,
                        "sender": current_user.username,
                        "text": clean_text,
                        "timestamp": int(time.time() * 1000),
                    }
                    await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, chat_payload)

                elif action == "abort_game":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    gid = int(game_id)
                    game_state = await state_manager.get_game_state(gid)
                    if not game_state or game_state.get("status") != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    abort_res = await state_manager.abort_game(db, gid)
                    if abort_res.get("status") == "error":
                        await manager.send_personal_message(
                            {"event": "error", "message": abort_res.get("reason", "Cannot abort game")},
                            current_user.id
                        )
                        continue

                    game_over_payload = {
                        "event": "game_over",
                        "game_id": gid,
                        "reason": "aborted",
                        "result": "*",
                        "white_delta": 0,
                        "black_delta": 0,
                        "white_new_rating": abort_res["white_new_rating"],
                        "black_new_rating": abort_res["black_new_rating"],
                    }
                    await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, game_over_payload)

                elif action == "resign":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    gid = int(game_id)
                    game_state = await state_manager.get_game_state(gid)
                    if not game_state or game_state["status"] != "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    game_result = "0-1" if current_user.id == white_id else "1-0"
                    if not await state_manager.claim_game_end(gid, game_result, "resignation"):
                        # Партию уже завершил другой обработчик (мат, флаг, ничья) — итог разослан им.
                        continue

                    rating_updates = await state_manager.finish_game(
                        db, gid, game_result, termination="resignation"
                    )

                    game_over_payload = {
                        "event": "game_over",
                        "game_id": gid,
                        "reason": "resignation",
                        "winner_id": black_id if current_user.id == white_id else white_id,
                        "result": game_result
                    }
                    game_over_payload.update(rating_updates)

                    await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, game_over_payload)

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

                    gid = int(game_id)
                    game_state = await state_manager.get_game_state(gid)
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

                    def _draw_offer_still_valid(fresh: dict, acceptor_id: int = current_user.id) -> bool:
                        offer = str(fresh.get("draw_offer") or "")
                        return offer.isdigit() and int(offer) != acceptor_id

                    claimed = await state_manager.claim_game_end(
                        gid, game_result, "agreement", guard=_draw_offer_still_valid,
                    )
                    if not claimed:
                        continue

                    rating_updates = await state_manager.finish_game(
                        db, gid, game_result, termination="agreement"
                    )

                    game_over_payload = {
                        "event": "game_over",
                        "game_id": gid,
                        "reason": "draw_agreement",
                        "result": game_result
                    }
                    game_over_payload.update(rating_updates)

                    await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, game_over_payload)

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

                elif action == "offer_rematch":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state.get("status") == "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    opponent_id = black_id if current_user.id == white_id else white_id
                    await state_manager.update_game_state(game_id, {"rematch_offer": str(current_user.id)})
                    await manager.send_personal_message(
                        {"event": "rematch_offered", "game_id": game_id, "player_id": current_user.id},
                        opponent_id
                    )

                elif action == "accept_rematch":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state or game_state.get("status") == "in_progress":
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    rematch_offer = game_state.get("rematch_offer")
                    if not rematch_offer or int(rematch_offer) == current_user.id:
                        await manager.send_personal_message(
                            {"event": "error", "message": "No active rematch offer to accept"},
                            current_user.id
                        )
                        continue

                    # Оповещение обоих игроков — внутри start_pvp_game. Если кто-то уже начал другую
                    # партию, придёт MatchmakingError, и предложение реванша останется в силе.
                    await create_rematch_game(db, game_state, connection_manager=manager)
                    await state_manager.update_game_state(game_id, {"rematch_offer": ""})

                elif action == "decline_rematch":
                    game_id = data.get("game_id")
                    if not game_id:
                        continue

                    game_state = await state_manager.get_game_state(game_id)
                    if not game_state:
                        continue

                    white_id, black_id = int(game_state["white_id"]), int(game_state["black_id"])
                    if current_user.id not in (white_id, black_id):
                        continue

                    opponent_id = black_id if current_user.id == white_id else white_id
                    await state_manager.update_game_state(game_id, {"rematch_offer": ""})
                    await manager.send_personal_message(
                        {"event": "rematch_declined", "game_id": game_id, "player_id": current_user.id},
                        opponent_id
                    )

                elif action == "make_move":
                    game_id = data.get("game_id")
                    move_str = data.get("move")
                    command_id = data.get("command_id") or uuid.uuid4().hex
                    expected_version = data.get("state_version")

                    if not game_id or not move_str:
                        continue

                    gid = int(game_id)
                    res = await state_manager.process_atomic_move(
                        game_id=gid,
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
                        server_elapsed_ms = res.get("elapsed_ms", 0)
                        client_time_ms = data.get("time_taken_ms", server_elapsed_ms)
                        network_lag_ms = max(0, server_elapsed_ms - int(client_time_ms))

                        await state_manager.save_move_telemetry(gid, {
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

                        await state_manager.sync_authoritative_state_to_db(db, gid, res)

                    if res["status"] == "game_over":
                        game_result = res["result"]
                        termination = res["termination"]
                        final_pgn = move_data["new_pgn"] if move_data else None

                        rating_updates = await state_manager.finish_game(
                            db, gid, game_result, termination=termination, final_pgn=final_pgn
                        )

                        if move_data:
                            move_payload = {
                                "event": "move_made",
                                "game_id": gid,
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
                            await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, move_payload)

                        game_over_payload = {
                            "event": "game_over",
                            "game_id": gid,
                            "reason": termination,
                            "result": game_result,
                            "white_time_ms": res["white_time_ms"],
                            "black_time_ms": res["black_time_ms"]
                        }
                        game_over_payload.update(rating_updates)

                        await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, game_over_payload)

                    elif res["status"] == "success":
                        move_payload = {
                            "event": "move_made",
                            "game_id": gid,
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

                        await broadcast_to_game_participants_and_spectators(gid, white_id, black_id, move_payload)

            except MatchmakingError as mm_err:
                await manager.send_personal_message(
                    {"event": "error", "code": mm_err.code, "message": mm_err.message},
                    current_user.id,
                )
            except Exception as action_err:
                logger.error("Error processing WS action '%s' for user %s: %s", action, current_user.id, action_err)
                await manager.send_personal_message(
                    {"event": "error", "message": "Internal server error processing action"},
                    current_user.id
                )

    except WebSocketDisconnect:
        # Закрываем только это соединение: другие вкладки пользователя остаются онлайн.
        await manager.disconnect(current_user.id, websocket)
    except Exception:
        logger.exception("WebSocket unexpected error for user %s", current_user.id)
        await manager.disconnect(current_user.id, websocket)
