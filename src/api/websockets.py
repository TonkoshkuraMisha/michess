# --- FILE: src/api/websockets.py ---

import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.api.deps import get_current_user_ws
from src.api.rate_limit import try_consume
from src.db.session import get_session_factory
from src.models.user import User
from src.services.anticheat import trusted_premove
from src.services.connection_manager import manager
from src.services.game_state import state_manager
from src.services.matchmaker import MatchmakingError, matchmaker
from src.services.rating import classify_time_control

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
    category = classify_time_control(int(state.get("base_time_ms", 180000)), int(state.get("increment_ms", 0)))

    payload = {
        "event": "match_found",
        "game_id": game_id,
        "color": "white" if user.id == white_id else "black",
        "opponent_id": black_id if user.id == white_id else white_id,
        "white_username": white_user.username if white_user else "Белые",
        "white_rating": white_user.rating_for(category) if white_user else 1200,
        "black_username": black_user.username if black_user else "Черные",
        "black_rating": black_user.rating_for(category) if black_user else 1200,
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
    Объект пользователя из аутентификации загружен при подключении и не видит изменения
    рейтинга после сыгранных партий — перечитываем его в сессии текущего действия.
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


# ---------------------------------------------------------------------------------------
# Обработчики действий WebSocket. Каждое действие клиента ("action") — отдельная функция,
# зарегистрированная в ACTION_HANDLERS; общие проверки (id партии, её статус, участие
# игрока) собраны в _participant_game.
# ---------------------------------------------------------------------------------------


class _Ignore(Exception):
    """Действие молча игнорируется: некорректный ввод, чужая или неподходящая по статусу партия."""


@dataclass
class ActionContext:
    user: User
    db: AsyncSession

    async def send(self, payload: dict) -> None:
        await self.release_db()
        await manager.send_personal_message(payload, self.user.id)

    async def release_db(self) -> None:
        """
        Завершает транзакцию сессии и возвращает соединение в пул до сетевого ввода-вывода.

        Любое чтение открывает транзакцию, которая держит соединение пула до конца действия, —
        в том числе пока ответ уходит медленному клиенту. Записи в сервисах (finish_game,
        abort_game, ...) коммитятся сами, поэтому здесь закрывается только транзакция чтения;
        expire_on_commit=False оставляет уже загруженные объекты доступными. Если сессии
        понадобится снова, она откроет новую транзакцию сама.
        """
        if self.db.in_transaction():
            await self.db.commit()

    async def error(self, message: str, **extra) -> None:
        await self.send({"event": "error", "message": message, **extra})


@dataclass
class GameRef:
    game_id: int
    state: dict
    white_id: int
    black_id: int

    def opponent_of(self, user_id: int) -> int:
        return self.black_id if user_id == self.white_id else self.white_id

    async def broadcast(self, payload: dict) -> None:
        await broadcast_to_game_participants_and_spectators(self.game_id, self.white_id, self.black_id, payload)


def _required_game_id(data: dict) -> int:
    game_id = data.get("game_id")
    if not game_id:
        raise _Ignore
    return int(game_id)


async def _load_game(data: dict) -> GameRef:
    gid = _required_game_id(data)
    state = await state_manager.get_game_state(gid)
    if not state:
        raise _Ignore
    return GameRef(gid, state, int(state["white_id"]), int(state["black_id"]))


async def _participant_game(ctx: ActionContext, data: dict, *, in_progress: bool | None) -> GameRef:
    """
    Партия из data["game_id"], в которой текущий пользователь — игрок.
    in_progress=True — только идущая, False — только завершённая, None — любая.
    """
    game = await _load_game(data)
    is_active = game.state.get("status") == "in_progress"
    if in_progress is not None and is_active != in_progress:
        raise _Ignore
    if ctx.user.id not in (game.white_id, game.black_id):
        raise _Ignore
    return game


ActionHandler = Callable[[ActionContext, dict], Awaitable[None]]
ACTION_HANDLERS: dict[str, ActionHandler] = {}


def action(name: str):
    def register(handler: ActionHandler) -> ActionHandler:
        ACTION_HANDLERS[name] = handler
        return handler
    return register


# --- Лобби и приглашения ---------------------------------------------------------------

@action("join_queue")
async def _join_queue(ctx: ActionContext, data: dict) -> None:
    fresh_user = await _fresh_current_user(ctx.db, ctx.user)
    base_time_ms = int(data.get("base_time_ms", 180000))
    increment_ms = int(data.get("increment_ms", 0))
    category = classify_time_control(base_time_ms, increment_ms)
    matched_game_id = await matchmaker.join_queue(
        fresh_user.id, fresh_user.username, fresh_user.rating_for(category),
        base_time_ms,
        increment_ms,
        min_rating=data.get("min_rating"),
        max_rating=data.get("max_rating"),
        db=ctx.db,
    )
    if matched_game_id is None:
        await ctx.send({"event": "queue_joined"})


@action("leave_queue")
async def _leave_queue(ctx: ActionContext, data: dict) -> None:
    await matchmaker.leave_queue(ctx.user.id)
    await ctx.send({"event": "queue_left"})


@action("accept_challenge")
async def _accept_challenge(ctx: ActionContext, data: dict) -> None:
    target_user_id = data.get("target_user_id")
    if not target_user_id:
        raise _Ignore
    await matchmaker.accept_challenge(int(target_user_id), ctx.user.id, manager, state_manager, db=ctx.db)


@action("create_invite")
async def _create_invite(ctx: ActionContext, data: dict) -> None:
    fresh_user = await _fresh_current_user(ctx.db, ctx.user)
    base_time_ms = int(data.get("base_time_ms", 180000))
    increment_ms = int(data.get("increment_ms", 2000))
    invite_data = await matchmaker.create_private_invite(
        user_id=fresh_user.id,
        username=fresh_user.username,
        rating=fresh_user.rating_for(classify_time_control(base_time_ms, increment_ms)),
        base_time_ms=base_time_ms,
        increment_ms=increment_ms,
        color_pref=str(data.get("color_pref", "random")),
    )
    await ctx.send({"event": "invite_created", **invite_data})


@action("accept_invite")
async def _accept_invite(ctx: ActionContext, data: dict) -> None:
    code = str(data.get("code", "")).strip()
    if not code:
        raise _Ignore
    await matchmaker.start_game_from_invite(code, ctx.user.id, manager, db=ctx.db)


# --- Зрители и чат ----------------------------------------------------------------------

@action("spectate_game")
async def _spectate_game(ctx: ActionContext, data: dict) -> None:
    game = await _load_game(data)
    if game.state.get("status") != "in_progress":
        await ctx.error("Партия уже завершена или не найдена")
        return

    await manager.add_spectator(game.game_id, ctx.user.id)
    white_user = await ctx.db.get(User, game.white_id)
    black_user = await ctx.db.get(User, game.black_id)
    white_time, black_time = _compute_live_clocks(game.state)
    category = classify_time_control(
        int(game.state.get("base_time_ms", 180000)), int(game.state.get("increment_ms", 0)),
    )

    await ctx.send({
        "event": "spectate_started",
        "game_id": game.game_id,
        "white_username": white_user.username if white_user else "Белые",
        "white_rating": white_user.rating_for(category) if white_user else 1200,
        "black_username": black_user.username if black_user else "Черные",
        "black_rating": black_user.rating_for(category) if black_user else 1200,
        "base_time_ms": int(game.state.get("base_time_ms", 180000)),
        "increment_ms": int(game.state.get("increment_ms", 0)),
        "white_time_ms": white_time,
        "black_time_ms": black_time,
        "fen": game.state.get("board_fen"),
        "pgn": game.state.get("pgn", ""),
        "state_version": int(game.state.get("state_version", 0)),
    })


@action("leave_spectate")
async def _leave_spectate(ctx: ActionContext, data: dict) -> None:
    game_id = data.get("game_id")
    if game_id:
        await manager.remove_spectator(int(game_id), ctx.user.id)
    else:
        await manager.remove_user_from_all_spectating(ctx.user.id)
    await ctx.send({"event": "spectate_left"})


@action("chat_message")
async def _chat_message(ctx: ActionContext, data: dict) -> None:
    raw_text = str(data.get("text", "")).strip()
    if not raw_text:
        raise _Ignore
    game = await _load_game(data)
    if ctx.user.id not in (game.white_id, game.black_id):
        # Писать в чат партии могут только игроки: зрители (и кто угодно, знающий id партии)
        # не должны спамить или подсказывать ходы.
        await ctx.error("Писать в чат партии могут только её участники", code="chat_forbidden")
        return

    await game.broadcast({
        "event": "chat_message",
        "game_id": game.game_id,
        "sender_id": ctx.user.id,
        "sender": ctx.user.username,
        "text": raw_text[:140],
        "timestamp": int(time.time() * 1000),
    })


# --- Завершение партии: отмена, сдача, ничья --------------------------------------------

@action("abort_game")
async def _abort_game(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=True)
    abort_res = await state_manager.abort_game(ctx.db, game.game_id)
    if abort_res.get("status") == "error":
        await ctx.error(abort_res.get("reason", "Cannot abort game"))
        return

    await game.broadcast({
        "event": "game_over",
        "game_id": game.game_id,
        "reason": "aborted",
        "result": "*",
        "white_delta": 0,
        "black_delta": 0,
        "white_new_rating": abort_res["white_new_rating"],
        "black_new_rating": abort_res["black_new_rating"],
    })


@action("resign")
async def _resign(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=True)
    game_result = "0-1" if ctx.user.id == game.white_id else "1-0"
    if not await state_manager.claim_game_end(game.game_id, game_result, "resignation"):
        return  # партию уже завершил другой обработчик (мат, флаг, ничья) — итог разослан им

    rating_updates = await state_manager.finish_game(ctx.db, game.game_id, game_result, termination="resignation")
    await game.broadcast({
        "event": "game_over",
        "game_id": game.game_id,
        "reason": "resignation",
        "winner_id": game.opponent_of(ctx.user.id),
        "result": game_result,
        **rating_updates,
    })


@action("offer_draw")
async def _offer_draw(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=True)
    # Одно предложение на позицию: повторное (или после отказа) — только после следующего хода.
    # Иначе предложения ничьей превращаются в способ дёргать соперника в цейтноте.
    version = str(game.state.get("state_version", 0))
    offered_key = f"draw_offered_at_{ctx.user.id}"
    if str(game.state.get(offered_key, "")) == version:
        await ctx.error("Ничью можно предложить один раз за ход", code="draw_offer_too_soon")
        return
    await state_manager.update_game_state(game.game_id, {"draw_offer": str(ctx.user.id), offered_key: version})
    await manager.send_personal_message(
        {"event": "draw_offered", "game_id": game.game_id, "player_id": ctx.user.id},
        game.opponent_of(ctx.user.id),
    )


@action("accept_draw")
async def _accept_draw(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=True)
    draw_offer = str(game.state.get("draw_offer") or "")
    if not draw_offer.isdigit() or int(draw_offer) == ctx.user.id:
        await ctx.error("No active draw offer to accept")
        return

    def _draw_offer_still_valid(fresh: dict, acceptor_id: int = ctx.user.id) -> bool:
        offer = str(fresh.get("draw_offer") or "")
        return offer.isdigit() and int(offer) != acceptor_id

    game_result = "1/2-1/2"
    if not await state_manager.claim_game_end(game.game_id, game_result, "agreement", guard=_draw_offer_still_valid):
        return

    rating_updates = await state_manager.finish_game(ctx.db, game.game_id, game_result, termination="agreement")
    await game.broadcast({
        "event": "game_over",
        "game_id": game.game_id,
        "reason": "draw_agreement",
        "result": game_result,
        **rating_updates,
    })


@action("decline_draw")
async def _decline_draw(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=True)
    await state_manager.update_game_state(game.game_id, {"draw_offer": ""})
    await manager.send_personal_message(
        {"event": "draw_declined", "game_id": game.game_id, "player_id": ctx.user.id},
        game.opponent_of(ctx.user.id),
    )


# --- Реванш -----------------------------------------------------------------------------

@action("offer_rematch")
async def _offer_rematch(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=False)
    await state_manager.update_game_state(game.game_id, {"rematch_offer": str(ctx.user.id)})
    await manager.send_personal_message(
        {"event": "rematch_offered", "game_id": game.game_id, "player_id": ctx.user.id},
        game.opponent_of(ctx.user.id),
    )


@action("accept_rematch")
async def _accept_rematch(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=False)
    rematch_offer = str(game.state.get("rematch_offer") or "")
    if not rematch_offer.isdigit() or int(rematch_offer) == ctx.user.id:
        await ctx.error("No active rematch offer to accept")
        return

    # Оповещение обоих игроков — внутри start_pvp_game. Если кто-то уже начал другую партию,
    # придёт MatchmakingError, и предложение реванша останется в силе.
    await create_rematch_game(ctx.db, game.state, connection_manager=manager)
    await state_manager.update_game_state(game.game_id, {"rematch_offer": ""})


@action("decline_rematch")
async def _decline_rematch(ctx: ActionContext, data: dict) -> None:
    game = await _participant_game(ctx, data, in_progress=None)
    await state_manager.update_game_state(game.game_id, {"rematch_offer": ""})
    await manager.send_personal_message(
        {"event": "rematch_declined", "game_id": game.game_id, "player_id": ctx.user.id},
        game.opponent_of(ctx.user.id),
    )


# --- Ход ----------------------------------------------------------------------------------

def _move_payload(ctx: ActionContext, gid: int, command_id: str, res: dict, move_data: dict, game_over: bool) -> dict:
    return {
        "event": "move_made",
        "game_id": gid,
        "player_id": ctx.user.id,
        "command_id": command_id,
        "state_version": res.get("state_version", 0),
        "move": move_data["uci"],
        "san": move_data["san"],
        "fen": move_data["new_fen"],
        "pgn": move_data["new_pgn"],
        "white_time_ms": res["white_time_ms"],
        "black_time_ms": res["black_time_ms"],
        "game_over": game_over,
    }


@action("make_move")
async def _make_move(ctx: ActionContext, data: dict) -> None:
    move_str = data.get("move")
    if not move_str:
        raise _Ignore
    gid = _required_game_id(data)
    command_id = data.get("command_id") or uuid.uuid4().hex

    res = await state_manager.process_atomic_move(
        game_id=gid,
        user_id=ctx.user.id,
        command_id=command_id,
        move_str=move_str,
        expected_version=data.get("state_version"),
    )
    if res["status"] == "ignored":
        return
    if res["status"] == "error":
        await ctx.error(
            res["reason"], fen=res.get("fen"), pgn=res.get("pgn"), state_version=res.get("state_version"),
        )
        return

    game = GameRef(gid, {}, res["white_id"], res["black_id"])
    move_data: dict = res.get("move_data") or {}

    if move_data:
        server_elapsed_ms = res.get("elapsed_ms", 0)
        client_time_ms = data.get("time_taken_ms", server_elapsed_ms)
        await state_manager.save_move_telemetry(gid, {
            "player_id": ctx.user.id,
            "move_number": move_data.get("fullmove_number", 1),
            "notation": move_data.get("uci", move_str),
            "san": move_data.get("san", move_str),
            "fen_after": move_data.get("new_fen", ""),
            "time_taken_ms": server_elapsed_ms,
            "window_blurred_before_move": bool(data.get("window_blurred", False)),
            "is_premove": trusted_premove(data.get("is_premove", False), server_elapsed_ms),
            "network_lag_ms": max(0, server_elapsed_ms - int(client_time_ms)),
        })
        await state_manager.sync_authoritative_state_to_db(ctx.db, gid, res)

    if res["status"] == "success":
        await game.broadcast(_move_payload(ctx, gid, command_id, res, move_data, game_over=False))
        return

    # game_over: мат/пат/ничья по правилам — или флаг, обнаруженный при попытке хода.
    game_result, termination = res["result"], res["termination"]
    rating_updates = await state_manager.finish_game(
        ctx.db, gid, game_result, termination=termination,
        final_pgn=move_data["new_pgn"] if move_data else None,
    )
    if move_data:
        await game.broadcast({
            **_move_payload(ctx, gid, command_id, res, move_data, game_over=True),
            "result": game_result,
            **rating_updates,
        })
    await game.broadcast({
        "event": "game_over",
        "game_id": gid,
        "reason": termination,
        "result": game_result,
        "white_time_ms": res["white_time_ms"],
        "black_time_ms": res["black_time_ms"],
        **rating_updates,
    })


# ---------------------------------------------------------------------------------------


async def _dispatch_action(
        session_factory: async_sessionmaker[AsyncSession],
        user: User,
        action_name: str,
        handler: ActionHandler,
        data: dict,
) -> None:
    """
    Выполняет одно действие в собственной короткой сессии БД.

    Сессия закрывается сразу после действия, и соединение возвращается в пул. Одна сессия на
    всё WebSocket-соединение держала бы транзакцию открытой, пока игрок подключён: при паре
    десятков игроков в лобби пул бы кончился и все запросы к БД вставали бы по таймауту.
    """
    async with session_factory() as db:
        ctx = ActionContext(user=user, db=db)
        try:
            await handler(ctx, data)
        except _Ignore:
            pass
        except MatchmakingError as mm_err:
            await ctx.error(mm_err.message, code=mm_err.code)
        except Exception:
            logger.exception("Error processing WS action '%s' for user %s", action_name, user.id)
            await ctx.error("Internal server error processing action")


# --- Ограничение частоты сообщений ------------------------------------------------------
#
# Лимиты считаются на пользователя (все его вкладки и воркеры вместе) в Redis, по группам
# действий: (сообщений, окно в секундах). Ходы ограничены щедро — пуля с премувами не должна
# упираться в лимит, — а чат и предложения строго, чтобы их нельзя было использовать для спама.

WS_MAX_MESSAGE_CHARS = 4096
WS_RATE_LIMITS: dict[str, tuple[int, int]] = {
    "moves": (60, 10),
    "chat": (5, 10),
    "offers": (6, 60),
    "lobby": (20, 10),
    "other": (30, 10),
}
_ACTION_GROUPS = {
    "make_move": "moves",
    "chat_message": "chat",
    "offer_draw": "offers", "offer_rematch": "offers",
    "join_queue": "lobby", "leave_queue": "lobby", "accept_challenge": "lobby",
    "create_invite": "lobby", "accept_invite": "lobby",
}
# Соединение, которое продолжает слать сообщения сверх лимита, закрывается: столько
# отклонённых сообщений за WS_STRIKE_WINDOW_S честный клиент не набирает.
WS_MAX_STRIKES = 30
WS_STRIKE_WINDOW_S = 10.0
WS_CLOSE_POLICY_VIOLATION = 1008


class _StrikeCounter:
    def __init__(self):
        self._times: list[float] = []

    def add(self) -> int:
        now = time.monotonic()
        self._times = [t for t in self._times if now - t < WS_STRIKE_WINDOW_S]
        self._times.append(now)
        return len(self._times)


async def _within_rate_limit(user_id: int, action_name: str) -> bool:
    group = _ACTION_GROUPS.get(action_name, "other")
    limit, window_s = WS_RATE_LIMITS[group]
    return await try_consume(f"ws:{group}", f"user:{user_id}", limit, window_s)


async def _reject_rate_limited(user: User, action_name: str, data: dict) -> None:
    payload: dict[str, Any] = {
        "event": "error",
        "code": "rate_limited",
        "action": action_name,
        "message": "Слишком много действий подряд, подождите немного",
    }
    if action_name == "make_move" and data.get("game_id"):
        # Клиент уже показал ход на доске — возвращаем ему актуальную позицию.
        try:
            state = await state_manager.get_game_state(int(data["game_id"]))
        except (TypeError, ValueError):
            state = None
        if state:
            payload.update(
                fen=state.get("board_fen"), pgn=state.get("pgn", ""),
                state_version=int(state.get("state_version", 0)),
            )
    await manager.send_personal_message(payload, user.id)


async def _handle_message(
        session_factory: async_sessionmaker[AsyncSession], user: User, raw: str,
) -> bool:
    """Разбирает и выполняет одно сообщение. False — сообщение отклонено (засчитывается в флуд)."""
    if len(raw) > WS_MAX_MESSAGE_CHARS:
        await manager.send_personal_message(
            {"event": "error", "code": "message_too_large", "message": "Слишком длинное сообщение"}, user.id,
        )
        return False
    try:
        data = json.loads(raw)
    except ValueError:
        return False  # мусор: ответа не шлём, но засчитываем
    if not isinstance(data, dict):
        return False

    action_name = str(data.get("action") or "")
    handler = ACTION_HANDLERS.get(action_name)
    if handler is None:
        return True  # неизвестное действие (например, от более новой версии клиента) — пропускаем

    if not await _within_rate_limit(user.id, action_name):
        await _reject_rate_limited(user, action_name, data)
        return False

    await _dispatch_action(session_factory, user, action_name, handler, data)
    return True


@router.websocket("/matchmaking")
async def matchmaking_endpoint(
        websocket: WebSocket,
        current_user: User = Depends(get_current_user_ws),
        session_factory: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
):
    await manager.connect(websocket, current_user.id)
    strikes = _StrikeCounter()
    try:
        await manager.send_personal_message(
            {"event": "connected", "message": f"Welcome, {current_user.username}!"}, current_user.id,
        )
        async with session_factory() as db:
            await _send_active_game_snapshot_if_exists(db, current_user)

        while True:
            raw = await websocket.receive_text()
            accepted = await _handle_message(session_factory, current_user, raw)
            if not accepted and strikes.add() >= WS_MAX_STRIKES:
                logger.warning("Closing WebSocket of user %s: message flood", current_user.id)
                await websocket.close(code=WS_CLOSE_POLICY_VIOLATION)
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket unexpected error for user %s", current_user.id)
    finally:
        # Закрываем только это соединение: другие вкладки пользователя остаются онлайн.
        await manager.disconnect(current_user.id, websocket)
