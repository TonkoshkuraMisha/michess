# --- FILE: src/services/game_state.py ---

import time
import json
import asyncio
import logging
import datetime
import chess
import chess.pgn
from sqlalchemy import select, or_
from sqlalchemy.sql import func
from redis.exceptions import WatchError

from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.models.user import User
from src.services.rating import elo_calculator
from src.worker.tasks import analyze_game_task
from src.services.anticheat import evaluate_game_telemetry
from src.services.game_engine import engine, STARTING_FEN

logger = logging.getLogger(__name__)


def _detect_eco_from_moves(moves_uci: list[str]) -> str:
    prefix = " ".join(moves_uci[:6])
    if prefix.startswith("e2e4 e7e5 g1f3 d7d6"):
        return "C41"
    if prefix.startswith("e2e4 e7e5 f2f4"):
        return "C30"
    if prefix.startswith("e2e4 e7e5 f1c4"):
        return "C23"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4"):
        return "C51"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1c4"):
        return "C50"
    if prefix.startswith("e2e4 e7e5 g1f3 b8c6 f1b5"):
        return "C60"
    if prefix.startswith("e2e4 c7c5"):
        return "B20"
    if prefix.startswith("e2e4 e7e6"):
        return "C00"
    if prefix.startswith("c2c4"):
        return "A10"
    if prefix.startswith("g1f3"):
        return "A04"
    if prefix.startswith("d2d4 d7d5 c2c4"):
        return "D06"
    if prefix.startswith("d2d4"):
        return "D00"
    if prefix.startswith("e2e4"):
        return "B00"
    return "A00"


_INT_STATE_KEYS = (
    "white_id", "black_id", "white_time_ms", "black_time_ms",
    "base_time_ms", "increment_ms", "last_move_at",
    "white_disconnect_started_at", "black_disconnect_started_at",
    "state_version",
)

ABANDON_TIMEOUT_MS = 3 * 60 * 1000


def _coerce_state(raw: dict) -> dict:
    """Приводит числовые поля сырого Redis-хэша к int (возвращает новый словарь)."""
    state = dict(raw)
    for key in _INT_STATE_KEYS:
        value = state.get(key)
        if value is not None and str(value).lstrip("-").isdigit():
            state[key] = int(value)
    if not state.get("board_fen"):
        state["board_fen"] = STARTING_FEN
    return state


def evaluate_clock_expiry(state: dict, now_ms: int) -> tuple[str, int, str] | None:
    """
    Чистая проверка флага / брошенной партии по состоянию (уже приведённому _coerce_state).
    Возвращает (result, winner_id, reason) или None, если партия продолжается.
    """
    white_id, black_id = int(state["white_id"]), int(state["black_id"])
    turn = state.get("turn", "white")

    for color in ("white", "black"):
        if state.get(f"{color}_disconnected") == "true":
            offline_duration = now_ms - int(state.get(f"{color}_disconnect_started_at") or now_ms)
            remaining_time = int(state[f"{color}_time_ms"])
            current_player_time = remaining_time - offline_duration if turn == color else remaining_time
            if current_player_time <= 0 or offline_duration >= min(remaining_time, ABANDON_TIMEOUT_MS):
                if color == "white":
                    return "0-1", black_id, "abandoned"
                return "1-0", white_id, "abandoned"

    elapsed = now_ms - int(state["last_move_at"])
    if turn in ("white", "w") and state.get("white_disconnected") != "true":
        if int(state["white_time_ms"]) - elapsed <= 0:
            return "0-1", black_id, "timeout"
    elif turn in ("black", "b") and state.get("black_disconnected") != "true":
        if int(state["black_time_ms"]) - elapsed <= 0:
            return "1-0", white_id, "timeout"
    return None


class GameStateManager:
    def __init__(self):
        self.redis = redis_client

    def _get_key(self, game_id: int) -> str:
        return f"game:{game_id}:state"

    async def initialize_game(self, game_id: int, white_id: int, black_id: int, base_time_ms: int, increment_ms: int):
        now_ms = int(time.time() * 1000)
        state = {
            "white_id": str(white_id),
            "black_id": str(black_id),
            "board_fen": STARTING_FEN,
            "pgn": "",
            "state_version": "0",
            "white_time_ms": str(base_time_ms),
            "black_time_ms": str(base_time_ms),
            "base_time_ms": str(base_time_ms),
            "increment_ms": str(increment_ms),
            "last_move_at": str(now_ms),
            "turn": "white",
            "status": "in_progress",
            "white_disconnected": "false",
            "black_disconnected": "false",
            "white_disconnect_started_at": "0",
            "black_disconnect_started_at": "0",
            "draw_offer": "",
            "rematch_offer": "",
        }
        await self.redis.hset(self._get_key(game_id), mapping=state)
        await self.redis.sadd("active_games", str(game_id))
        await self.redis.set(f"user:{white_id}:current_game", str(game_id))
        await self.redis.set(f"user:{black_id}:current_game", str(game_id))

    init_game = initialize_game

    async def get_game_state(self, game_id: int) -> dict | None:
        state = await self.redis.hgetall(self._get_key(game_id))
        if not state:
            return await self._recover_state_from_db(game_id)
        return _coerce_state(state)

    async def claim_game_end(
            self,
            game_id: int,
            result: str,
            termination: str,
            status: str = "completed",
            guard=None,
    ) -> dict | None:
        """
        Атомарно переводит партию из in_progress в финальный статус (WATCH/MULTI).

        Это единственная точка «захвата» завершения партии: из нескольких конкурентных
        претендентов (сдача, ничья, флаг, отмена, брошенная партия) успех получает ровно один,
        и только он должен вызывать finish_game / abort_game и рассылать game_over.

        guard(state) -> bool — дополнительное условие, перепроверяемое на свежем состоянии
        внутри транзакции (например, что флаг всё ещё упал, а предложение ничьей ещё в силе).

        Возвращает состояние партии на момент захвата или None, если партию уже завершил
        кто-то другой либо guard не выполнен.
        """
        game_key = self._get_key(game_id)
        async with self.redis.pipeline(transaction=True) as pipe:
            while True:
                try:
                    await pipe.watch(game_key)
                    raw = await pipe.hgetall(game_key)
                    if not raw or raw.get("status") != "in_progress":
                        await pipe.unwatch()
                        return None

                    state = _coerce_state(raw)
                    if guard is not None and not guard(state):
                        await pipe.unwatch()
                        return None

                    pipe.multi()
                    pipe.hset(game_key, mapping={
                        "status": status,
                        "result": result,
                        "termination": termination,
                    })
                    await pipe.execute()
                    return state
                except WatchError:
                    continue

    async def _recover_state_from_db(self, game_id: int) -> dict | None:
        """Восстанавливает состояние партии в Redis из PostgreSQL."""
        try:
            async with AsyncSessionLocal() as db:
                db_game = await db.get(Game, game_id)
                if not db_game:
                    return None

                now_ms = int(time.time() * 1000)
                turn_str = "white" if db_game.turn in ("w", "white") else "black"
                white_time = db_game.white_time_ms if db_game.white_time_ms is not None else db_game.base_time_ms
                black_time = db_game.black_time_ms if db_game.black_time_ms is not None else db_game.base_time_ms
                last_move = db_game.last_move_at if db_game.last_move_at is not None else now_ms

                status_map = {
                    GameStatus.IN_PROGRESS: "in_progress",
                    GameStatus.COMPLETED: "completed",
                    GameStatus.ABORTED: "aborted",
                    GameStatus.PENDING: "pending",
                }
                status_str = status_map.get(db_game.status, "completed")

                state = {
                    "white_id": str(db_game.white_player_id),
                    "black_id": str(db_game.black_player_id),
                    "board_fen": db_game.board_fen or STARTING_FEN,
                    "pgn": db_game.pgn or "",
                    "state_version": str(db_game.state_version or 0),
                    "white_time_ms": str(white_time),
                    "black_time_ms": str(black_time),
                    "base_time_ms": str(db_game.base_time_ms),
                    "increment_ms": str(db_game.increment_ms),
                    "last_move_at": str(last_move),
                    "turn": turn_str,
                    "status": status_str,
                    "white_disconnected": "false",
                    "black_disconnected": "false",
                    "white_disconnect_started_at": "0",
                    "black_disconnect_started_at": "0",
                }
                await self.redis.hset(self._get_key(game_id), mapping=state)
                if status_str == "in_progress":
                    await self.redis.sadd("active_games", str(game_id))
                    await self.redis.set(f"user:{db_game.white_player_id}:current_game", str(game_id))
                    await self.redis.set(f"user:{db_game.black_player_id}:current_game", str(game_id))
                return await self.get_game_state(game_id)
        except Exception as e:
            logger.error("Failed to recover game %s from DB: %s", game_id, e)
            return None

    async def update_game_state(self, game_id: int, updates: dict):
        str_updates = {k: str(v) for k, v in updates.items()}
        await self.redis.hset(self._get_key(game_id), mapping=str_updates)

    async def clear_game_state(self, game_id: int):
        state = await self.redis.hgetall(self._get_key(game_id))
        if state:
            await self.redis.delete(f"user:{state.get('white_id')}:current_game")
            await self.redis.delete(f"user:{state.get('black_id')}:current_game")
        await self.redis.delete(self._get_key(game_id))
        await self.redis.delete(f"game:{game_id}:commands")
        await self.redis.srem("active_games", str(game_id))

    async def save_move_telemetry(self, game_id: int, move_data: dict):
        key = f"game:{game_id}:moves"
        await self.redis.rpush(key, json.dumps(move_data))

    async def extract_all_moves(self, game_id: int) -> list[dict]:
        key = f"game:{game_id}:moves"
        moves_raw = await self.redis.lrange(key, 0, -1)
        await self.redis.delete(key)
        return [json.loads(m) for m in moves_raw]

    async def process_atomic_move(
            self,
            game_id: int,
            user_id: int,
            command_id: str,
            move_str: str,
            expected_version: int | None = None,
    ) -> dict:
        game_key = self._get_key(game_id)
        cmd_key = f"game:{game_id}:commands"

        async with self.redis.pipeline(transaction=True) as pipe:
            while True:
                try:
                    await pipe.watch(game_key, cmd_key)

                    is_processed = await pipe.sismember(cmd_key, command_id)
                    if is_processed:
                        await pipe.unwatch()
                        return {"status": "ignored", "reason": "already_processed"}

                    state = await pipe.hgetall(game_key)
                    if not state or state.get("status") != "in_progress":
                        await pipe.unwatch()
                        return {"status": "error", "reason": "game_inactive"}

                    current_version = int(state.get("state_version", 0))
                    if expected_version is not None and int(expected_version) != current_version:
                        await pipe.unwatch()
                        return {
                            "status": "error",
                            "reason": "version_mismatch",
                            "state_version": current_version,
                            "fen": state.get("board_fen", STARTING_FEN),
                            "pgn": state.get("pgn", ""),
                        }

                    turn = state.get("turn", "white")
                    white_id = int(state["white_id"])
                    black_id = int(state["black_id"])

                    is_white_turn = turn in ("white", "w")
                    expected_player_id = white_id if is_white_turn else black_id

                    if user_id != expected_player_id:
                        await pipe.unwatch()
                        return {"status": "error", "reason": "not_your_turn"}

                    now_ms = int(time.time() * 1000)
                    last_move_at = int(state["last_move_at"])
                    elapsed_ms = max(0, now_ms - last_move_at)

                    increment = int(state["increment_ms"])
                    white_time = int(state["white_time_ms"])
                    black_time = int(state["black_time_ms"])

                    remaining_after_move = (white_time if is_white_turn else black_time) - elapsed_ms
                    if remaining_after_move <= 0:
                        # Флаг упал до хода: завершаем партию в той же транзакции, чтобы
                        # check_timeouts_loop или другой обработчик не завершили её повторно.
                        flag_result = "0-1" if is_white_turn else "1-0"
                        final_white = 0 if is_white_turn else white_time
                        final_black = black_time if is_white_turn else 0
                        pipe.multi()
                        pipe.hset(game_key, mapping={
                            "status": "completed",
                            "result": flag_result,
                            "termination": "timeout",
                            "white_time_ms": str(final_white),
                            "black_time_ms": str(final_black),
                        })
                        pipe.sadd(cmd_key, command_id)
                        await pipe.execute()
                        return {
                            "status": "game_over",
                            "result": flag_result,
                            "termination": "timeout",
                            "white_id": white_id,
                            "black_id": black_id,
                            "white_time_ms": final_white,
                            "black_time_ms": final_black,
                            "elapsed_ms": elapsed_ms,
                        }

                    if is_white_turn:
                        new_white_time = remaining_after_move + increment
                        new_black_time = black_time
                    else:
                        new_black_time = remaining_after_move + increment
                        new_white_time = white_time

                    current_fen = state.get("board_fen") or STARTING_FEN
                    current_pgn = state.get("pgn") or ""

                    is_valid, move_data = engine.process_move(current_fen, move_str, current_pgn)
                    if not is_valid or not move_data:
                        await pipe.unwatch()
                        return {"status": "error", "reason": "illegal_move"}

                    new_version = current_version + 1
                    new_turn = "black" if is_white_turn else "white"

                    pipe.multi()

                    if move_data["is_game_over"]:
                        updates = {
                            "status": "completed",
                            "result": move_data["result"],
                            "termination": move_data["termination"],
                            "state_version": str(new_version),
                            "board_fen": move_data["new_fen"],
                            "pgn": move_data["new_pgn"],
                            "last_move_at": str(now_ms),
                            "white_time_ms": str(new_white_time),
                            "black_time_ms": str(new_black_time),
                        }
                        pipe.hset(game_key, mapping=updates)
                        pipe.sadd(cmd_key, command_id)
                        await pipe.execute()
                        return {
                            "status": "game_over",
                            "result": move_data["result"],
                            "termination": move_data["termination"],
                            "move_data": move_data,
                            "state_version": new_version,
                            "white_time_ms": new_white_time,
                            "black_time_ms": new_black_time,
                            "white_id": white_id,
                            "black_id": black_id,
                            "elapsed_ms": elapsed_ms,
                            "now_ms": now_ms,
                        }

                    updates = {
                        "state_version": str(new_version),
                        "turn": new_turn,
                        "board_fen": move_data["new_fen"],
                        "pgn": move_data["new_pgn"],
                        "last_move_at": str(now_ms),
                        "white_time_ms": str(new_white_time),
                        "black_time_ms": str(new_black_time),
                    }

                    pipe.hset(game_key, mapping=updates)
                    pipe.sadd(cmd_key, command_id)
                    pipe.expire(cmd_key, 86400)

                    await pipe.execute()

                    return {
                        "status": "success",
                        "move_data": move_data,
                        "state_version": new_version,
                        "turn": new_turn,
                        "white_time_ms": new_white_time,
                        "black_time_ms": new_black_time,
                        "white_id": white_id,
                        "black_id": black_id,
                        "elapsed_ms": elapsed_ms,
                        "now_ms": now_ms,
                    }

                except WatchError:
                    continue

    async def sync_authoritative_state_to_db(self, db, game_id: int, res: dict):
        db_game = await db.get(Game, game_id)
        if not db_game:
            return

        move_data = res.get("move_data")
        if move_data:
            db_game.board_fen = move_data["new_fen"]
            db_game.pgn = move_data["new_pgn"]

        if "state_version" in res:
            db_game.state_version = res["state_version"]
        if "turn" in res:
            db_game.turn = "w" if res["turn"] == "white" else "b"
        if "white_time_ms" in res:
            db_game.white_time_ms = res["white_time_ms"]
        if "black_time_ms" in res:
            db_game.black_time_ms = res["black_time_ms"]
        if "now_ms" in res:
            db_game.last_move_at = res["now_ms"]

        await db.commit()

    async def finish_game(self, db, game_id: int, result: str, termination: str = "unknown",
                          final_pgn: str = None) -> dict:
        """
        Фиксирует итог партии в БД и пересчитывает рейтинги.

        Вызывать только после успешного claim_game_end (или из ветки game_over process_atomic_move,
        которая захватывает завершение в своей транзакции). Дополнительно, на случай гонки между
        процессами или потери состояния Redis, строки партии и игроков блокируются
        (SELECT ... FOR UPDATE) и перечитываются из БД мимо identity map сессии, поэтому
        повторный вызов не начислит рейтинг второй раз.
        """
        db_game = await db.get(Game, game_id, with_for_update=True, populate_existing=True)
        if not db_game:
            return {}

        if db_game.status in (GameStatus.COMPLETED, GameStatus.ABORTED):
            await db.commit()  # снимаем блокировку
            return {
                "white_delta": db_game.white_rating_delta or 0,
                "black_delta": db_game.black_rating_delta or 0
            }

        # Блокируем игроков в фиксированном порядке (по id), чтобы параллельно завершающиеся
        # партии одного игрока не теряли обновление рейтинга и не взаимоблокировались.
        locked_users: dict[int, User] = {}
        for uid in sorted({db_game.white_player_id, db_game.black_player_id}):
            locked_users[uid] = await db.get(User, uid, with_for_update=True, populate_existing=True)
        white_user = locked_users[db_game.white_player_id]
        black_user = locked_users[db_game.black_player_id]

        white_initial = white_user.rating
        black_initial = black_user.rating
        delta_w = delta_b = 0
        new_w = white_initial
        new_b = black_initial

        if db_game.is_rated:
            w_games_q = select(func.count(Game.id)).where(
                or_(Game.white_player_id == white_user.id, Game.black_player_id == white_user.id),
                Game.status == GameStatus.COMPLETED,
                Game.is_rated == True,  # noqa: E712
            )
            b_games_q = select(func.count(Game.id)).where(
                or_(Game.white_player_id == black_user.id, Game.black_player_id == black_user.id),
                Game.status == GameStatus.COMPLETED,
                Game.is_rated == True,  # noqa: E712
            )
            white_games_count = (await db.execute(w_games_q)).scalar() or 0
            black_games_count = (await db.execute(b_games_q)).scalar() or 0

            new_w, delta_w, new_b, delta_b = elo_calculator.calculate_new_ratings(
                white_initial,
                black_initial,
                result,
                white_games=white_games_count,
                black_games=black_games_count,
            )
            white_user.rating = new_w
            black_user.rating = new_b

        db_game.result = result
        db_game.termination = termination

        if result == "1-0":
            db_game.winner_id = white_user.id
        elif result == "0-1":
            db_game.winner_id = black_user.id

        db_game.white_initial_rating = white_initial
        db_game.black_initial_rating = black_initial
        db_game.white_rating_delta = delta_w
        db_game.black_rating_delta = delta_b

        state = await self.redis.hgetall(self._get_key(game_id))
        if state:
            if state.get("state_version"):
                db_game.state_version = int(state["state_version"])
            if state.get("board_fen"):
                db_game.board_fen = state["board_fen"]
            if state.get("white_time_ms"):
                db_game.white_time_ms = int(state["white_time_ms"])
            if state.get("black_time_ms"):
                db_game.black_time_ms = int(state["black_time_ms"])
            if not final_pgn:
                final_pgn = state.get("pgn")

        today_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y.%m.%d")
        db_game.status = GameStatus.COMPLETED
        db_game.finished_at = func.now()
        db_game.pgn_date = today_str
        db_game.site = "MiChess"

        moves_telemetry = await self.extract_all_moves(game_id)
        if moves_telemetry:
            db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
            db.add_all(db_moves)

            uci_seq = [m.get("notation", "") for m in moves_telemetry if m.get("notation")]
            eco_code = _detect_eco_from_moves(uci_seq)
            db_game.eco = eco_code

            pgn_game = chess.pgn.Game()
            pgn_game.headers["Event"] = "MiChess Rated Game" if db_game.is_rated else "MiChess Casual Game"
            pgn_game.headers["Site"] = "MiChess"
            pgn_game.headers["Date"] = today_str
            pgn_game.headers["White"] = white_user.username
            pgn_game.headers["Black"] = black_user.username
            pgn_game.headers["WhiteElo"] = str(white_initial)
            pgn_game.headers["BlackElo"] = str(black_initial)
            pgn_game.headers["Result"] = result
            pgn_game.headers["ECO"] = eco_code
            pgn_game.headers["TimeControl"] = f"{db_game.base_time_ms // 1000}+{db_game.increment_ms // 1000}"
            pgn_game.headers["Termination"] = termination

            node = pgn_game
            board_for_pgn = chess.Board()
            for m in moves_telemetry:
                try:
                    move_obj = chess.Move.from_uci(m["notation"])
                    if move_obj in board_for_pgn.legal_moves:
                        board_for_pgn.push(move_obj)
                        node = node.add_variation(move_obj)
                    else:
                        break
                except ValueError:
                    break
            db_game.pgn = str(pgn_game)
        elif final_pgn:
            db_game.pgn = final_pgn
            from src.db.seed import extract_pgn_metadata
            meta = extract_pgn_metadata(final_pgn, fallback_result=result)
            if meta["pgn_date"]:
                db_game.pgn_date = meta["pgn_date"]
            if meta["site"]:
                db_game.site = meta["site"]
            if meta["eco"]:
                db_game.eco = meta["eco"]

        await db.commit()

        if db_game.is_rated:
            try:
                await evaluate_game_telemetry(db, game_id)
            except Exception as ac_err:
                logger.error("Telemetry anti-cheat evaluation failed for game %s: %s", game_id, ac_err)

        await self.clear_game_state(game_id)

        try:
            analyze_game_task.delay(game_id)
        except Exception as e:
            logger.error("Could not schedule Celery analysis task for game %s: %s", game_id, e)

        return {
            "white_delta": delta_w,
            "black_delta": delta_b,
            "white_new_rating": new_w,
            "black_new_rating": new_b
        }

    async def handle_player_disconnect(self, user_id: int, manager):
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str:
            return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress":
            return

        white_id, black_id = int(state["white_id"]), int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        now_ms = int(time.time() * 1000)
        await self.update_game_state(game_id, {
            f"{color}_disconnected": "true",
            f"{color}_disconnect_started_at": str(now_ms),
        })

        remaining_time = state["white_time_ms"] if color == "white" else state["black_time_ms"]
        max_wait_ms = min(remaining_time, 3 * 60 * 1000)
        await manager.send_personal_message(
            {"event": "opponent_disconnected", "game_id": game_id, "max_wait_ms": max_wait_ms},
            opponent_id,
        )

    async def handle_player_reconnect(self, user_id: int, manager):
        game_id_str = await self.redis.get(f"user:{user_id}:current_game")
        if not game_id_str:
            return
        game_id = int(game_id_str)
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress":
            return

        white_id, black_id = int(state["white_id"]), int(state["black_id"])
        color = "white" if user_id == white_id else "black"
        opponent_id = black_id if color == "white" else white_id

        if state.get(f"{color}_disconnected") == "true":
            now_ms = int(time.time() * 1000)
            offline_duration = now_ms - state.get(f"{color}_disconnect_started_at", now_ms)
            updates = {f"{color}_disconnected": "false", f"{color}_disconnect_started_at": "0"}

            turn = state.get("turn", "white")
            if turn == color:
                time_key = f"{color}_time_ms"
                updates[time_key] = str(max(0, state[time_key] - offline_duration))
            updates["last_move_at"] = str(state["last_move_at"] + offline_duration)

            await self.update_game_state(game_id, updates)
            await manager.send_personal_message({"event": "opponent_reconnected", "game_id": game_id}, opponent_id)

    async def check_timeouts_loop(self, manager):
        while True:
            try:
                active_game_ids = list(await self.redis.smembers("active_games"))
                now_ms = int(time.time() * 1000)

                for game_id_str in active_game_ids:
                    game_id = int(game_id_str)
                    state = await self.get_game_state(game_id)
                    if not state or state["status"] != "in_progress":
                        await self.redis.srem("active_games", game_id_str)
                        continue

                    if int(state.get("state_version", 0)) < 2 and now_ms - int(
                            state.get("last_move_at", now_ms)) >= 30000:
                        async with AsyncSessionLocal() as db:
                            await self.check_first_move_abort_timeout(db, game_id, manager=manager, timeout_ms=30000)
                        continue

                    white_id, black_id = int(state["white_id"]), int(state["black_id"])
                    decision = evaluate_clock_expiry(state, now_ms)

                    if decision:
                        game_result, winner_id, reason = decision

                        # Решение перепроверяется на свежем состоянии внутри транзакции: игрок мог
                        # успеть сходить, переподключиться или сдаться, пока мы читали состояние.
                        claimed = await self.claim_game_end(
                            game_id, game_result, reason,
                            guard=lambda fresh, expected=decision: evaluate_clock_expiry(fresh, now_ms) == expected,
                        )
                        if not claimed:
                            continue

                        logger.info("Game %s ended. Result: %s, Reason: %s", game_id, game_result, reason)

                        async with AsyncSessionLocal() as db:
                            rating_updates = await self.finish_game(db, game_id, game_result, termination=reason)

                        game_over_payload = {
                            "event": "game_over",
                            "game_id": game_id,
                            "reason": reason,
                            "winner_id": winner_id,
                            "result": game_result,
                        }
                        game_over_payload.update(rating_updates)

                        await manager.send_personal_message(game_over_payload, white_id)
                        await manager.send_personal_message(game_over_payload, black_id)
                        if hasattr(manager, "broadcast_to_spectators"):
                            await manager.broadcast_to_spectators(game_id, game_over_payload)

            except Exception as e:
                logger.error("Error in check_timeouts_loop: %s", e)

            await asyncio.sleep(0.5)

    async def abort_game(self, db, game_id: int, guard=None) -> dict:
        """
        Отменяет партию на 1-м ходу (до 2 полуходов) без изменения рейтинга.
        guard(state) -> bool — дополнительное условие, атомарно перепроверяемое при захвате.
        """
        state = await self.get_game_state(game_id)
        if not state or state.get("status") != "in_progress":
            return {"status": "error", "reason": "Game is not in progress"}

        state_version = int(state.get("state_version", 0))
        if state_version >= 2:
            return {"status": "error", "reason": "Cannot abort game after move 1"}

        white_id = int(state["white_id"])
        black_id = int(state["black_id"])

        def _abort_allowed(fresh: dict) -> bool:
            if int(fresh.get("state_version", 0)) >= 2:
                return False
            return guard(fresh) if guard is not None else True

        claimed = await self.claim_game_end(
            game_id, "*", "aborted", status="aborted", guard=_abort_allowed,
        )
        if not claimed:
            return {"status": "error", "reason": "Game is not in progress"}

        await self.redis.srem("active_games", str(game_id))
        await self.redis.delete(f"user:{white_id}:current_game")
        await self.redis.delete(f"user:{black_id}:current_game")

        from datetime import datetime, timezone

        db_game = await db.get(Game, game_id, with_for_update=True, populate_existing=True)
        white_user = await db.get(User, white_id)
        black_user = await db.get(User, black_id)

        w_rating = white_user.rating if white_user else 1200
        b_rating = black_user.rating if black_user else 1200

        if db_game and db_game.status not in (GameStatus.COMPLETED, GameStatus.ABORTED):
            db_game.status = GameStatus.ABORTED
            db_game.result = "*"
            db_game.termination = "aborted"
            db_game.white_rating_delta = 0
            db_game.black_rating_delta = 0
            is_tz = getattr(Game.__table__.c.finished_at.type, "timezone", False)
            now_utc = datetime.now(timezone.utc)
            db_game.finished_at = now_utc if is_tz else now_utc.replace(tzinfo=None)
            await db.commit()

        return {
            "status": "aborted",
            "result": "*",
            "termination": "aborted",
            "white_id": white_id,
            "black_id": black_id,
            "white_delta": 0,
            "black_delta": 0,
            "white_new_rating": w_rating,
            "black_new_rating": b_rating,
        }

    async def check_first_move_abort_timeout(self, db, game_id: int, manager=None, timeout_ms: int = 30000) -> bool:
        """Проверяет, не истекли ли 30 секунд на первые 2 полухода партии. Если истекли — отменяет игру."""
        state = await self.get_game_state(game_id)
        if not state or state.get("status") != "in_progress":
            return False

        if int(state.get("state_version", 0)) >= 2:
            return False

        now_ms = int(time.time() * 1000)
        last_move_at = int(state.get("last_move_at", now_ms))
        if now_ms - last_move_at < timeout_ms:
            return False

        def _still_idle(fresh: dict) -> bool:
            return int(time.time() * 1000) - int(fresh.get("last_move_at", 0)) >= timeout_ms

        res = await self.abort_game(db, game_id, guard=_still_idle)
        if res.get("status") == "aborted" and manager is not None:
            payload = {
                "event": "game_over",
                "game_id": game_id,
                "reason": "aborted",
                "result": "*",
                "white_delta": 0,
                "black_delta": 0,
                "white_new_rating": res["white_new_rating"],
                "black_new_rating": res["black_new_rating"],
            }
            await manager.send_personal_message(payload, res["white_id"])
            await manager.send_personal_message(payload, res["black_id"])
            if hasattr(manager, "broadcast_to_spectators"):
                await manager.broadcast_to_spectators(game_id, payload)
        return res.get("status") == "aborted"


state_manager = GameStateManager()
