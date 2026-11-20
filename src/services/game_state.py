# --- FILE: src/services/game_state.py ---
"""
Состояние идущей партии между людьми: позиция, часы, завершение. Источник правды во время игры — Redis.

Где лежит (Redis): хэш game:{id}:state (позиция, запись ходов, время сторон, момент последнего хода, версия
состояния, предложение ничьей и реванша, берсерк, расход квоты лага, отметки отключения), журнал обработанных
команд game:{id}:commands, журнал ходов с телеметрией game:{id}:moves, ссылка игрока на партию
user:{id}:current_game, множество идущих партий active_games, сроки game_deadlines, реестр завершённых в Redis, но не
записанных в БД партий games:pending_finish и ключ лидера цикла таймаутов timeouts:leader. В таблицу games
состояние копируется после каждого хода (sync_authoritative_state_to_db); если хэш пропал, он восстанавливается из
неё (_recover_state_from_db).
Вызывают: src/api/websockets.py (ходы, сдача, ничья, берсерк), src/api/profile.py и src/api/fair_play.py (чтение
состояния), src/services/connection_manager.py (отключение и возврат игрока), src/services/arena.py (берсерк),
src/main.py (запуск цикла таймаутов).

Ход (process_atomic_move) — одна транзакция Redis (WATCH/MULTI): очередь хода, версия, легальность
(src/services/game_engine.py), списание времени, новая позиция. Повтор той же команды (command_id) не применяется.

Часы: время идёт у стороны, которая ходит, от момента последнего хода по часам сервера; разрыв связи их не
останавливает. Квота лага — LAG_PER_MOVE_MS и LAG_PER_GAME_MS: задержка сети (время сервера минус время
обдумывания, названное клиентом) возвращается игроку в пределах квоты, и флаг падает с отсрочкой на её остаток.

Завершение: мат и ничьи — при ходе (в ней же падает флаг, если игрок успел сходить уже после срока); флаг без хода,
неявка на первый ход (30 с) и брошенная партия (ABANDON_TIMEOUT_MS) —
цикл check_timeouts_loop, который ведёт один процесс-лидер и проверяет только партии с подошедшим сроком.
Завершить партию может один претендент (claim_game_end). finish_game записывает итог: рейтинг
(src/services/rating.py), ходы с телеметрией в moves, оценку античита, очки арены, постановку разбора в фон.
Если процесс упал между завершением в Redis и записью в базу, партию дозавершит сверка
(reconcile_unfinished_games).
"""

import asyncio
import datetime
import json
import logging
import time
from datetime import UTC

import chess
import chess.pgn
from redis.exceptions import WatchError
from sqlalchemy import select
from sqlalchemy.sql import func

from src.core.instance import WORKER_ID
from src.core.observability import GAMES_FINISHED, TIMEOUT_CHECK_FAILURES, bounded_label
from src.db.redis import redis_client
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.move import Move
from src.models.user import User
from src.services import openings, product_metrics
from src.services.anticheat import evaluate_game_telemetry
from src.services.game_engine import (  # noqa: F401  (flag_outcome реэкспортируется для тестов)
    FLAG_DRAW_TERMINATION,
    STARTING_FEN,
    board_from_fen,
    engine,
    flag_outcome,
    side_has_mating_material,
)
from src.services.odds import pgn_header
from src.services.rating import classify_time_control, elo_calculator
from src.services.task_dispatch import schedule_game_analysis_in_background

logger = logging.getLogger(__name__)


# Поля хэша состояния, которые _coerce_state приводит к int (в Redis всё хранится строками).
_INT_STATE_KEYS = (
    "white_id", "black_id", "white_time_ms", "black_time_ms",
    "base_time_ms", "increment_ms", "last_move_at",
    "white_disconnect_started_at", "black_disconnect_started_at",
    "state_version", "white_lag_ms", "black_lag_ms",
)

# Квота лага (таск 33.3, docs/research/arenas.md): время, потерянное на пересылку хода по сети, возвращается игроку —
# не больше LAG_PER_MOVE_MS за ход и LAG_PER_GAME_MS за партию. Лаг хода = время по часам сервера минус время
# обдумывания, названное клиентом; клиенту верим только в пределах квоты, поэтому выгадать больше неё нельзя.
LAG_PER_MOVE_MS = 300
LAG_PER_GAME_MS = 2000

# Сколько секунд хэш уже завершённой партии остаётся в Redis после восстановления из БД (для реванша и чата).
FINISHED_STATE_TTL_S = 6 * 60 * 60
# Сколько отключившийся игрок может отсутствовать до поражения за брошенную партию (3 минуты).
ABANDON_TIMEOUT_MS = 3 * 60 * 1000
# Код итога, когда брошена партия, но у оставшегося игрока нет материала для мата: ничья вместо победы.
ABANDON_DRAW_TERMINATION = "abandoned_vs_insufficient_material"

# Ключ лидера цикла таймаутов и его срок жизни: лидер продлевает ключ каждым проходом (раз в 0,5 с), поэтому
# упавший лидер теряет роль не дольше чем через TIMEOUTS_LEADER_TTL_MS.
TIMEOUTS_LEADER_KEY = "timeouts:leader"
TIMEOUTS_LEADER_TTL_MS = 3000

# Партия, на которой проверка таймаутов падает, откладывается: 1 с, 2 с, 4 с ... до 30 с.
TIMEOUT_RETRY_BASE_MS = 1000
TIMEOUT_RETRY_MAX_MS = 30_000
# Как часто (каждый N-й сбой подряд) писать в лог полный стек по одной и той же партии.
TIMEOUT_FAILURE_LOG_EVERY = 20

# Партии, завершённые в Redis, но ещё не записанные в БД: id -> момент завершения (ms).
# Запись добавляется в той же транзакции, что и смена статуса, и снимается только после
# коммита итога в БД. Если процесс упал между этими шагами, сверка дозавершит партию.
PENDING_FINISH_KEY = "games:pending_finish"
# Сколько ждать штатного обработчика, прежде чем дозавершать партию сверкой.
RECONCILE_GRACE_MS = 30_000
# Как часто лидер цикла таймаутов запускает сверку Redis и БД.
RECONCILE_INTERVAL_MS = 30_000


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


def is_rated_state(state: dict) -> bool:
    """Рейтинговая ли партия. У состояний, созданных до появления товарищеских партий, поля нет — они рейтинговые."""
    return str(state.get("is_rated", "1")) != "0"


def pending_draw_offer(state: dict) -> int | None:
    """id игрока, чьё предложение ничьей сейчас в силе, или None."""
    offer = str(state.get("draw_offer") or "")
    return int(offer) if offer.isdigit() else None


def _move_rejection(reason: str, raw_state: dict) -> dict:
    """
    Отказ в ходе вместе с актуальной позицией. Клиент показывает свой ход сразу, не дожидаясь
    сервера, — без позиции в ответе отклонённый ход так и оставался бы у него на доске.
    """
    version = str(raw_state.get("state_version", 0))
    return {
        "status": "error",
        "reason": reason,
        "state_version": int(version) if version.isdigit() else 0,
        "fen": raw_state.get("board_fen") or STARTING_FEN,
        "pgn": raw_state.get("pgn", ""),
    }


def side_to_move(state: dict) -> str:
    """Чей ход: "white" или "black" (поле turn бывает и "w"; по умолчанию ходят белые)."""
    return "white" if state.get("turn", "white") in ("white", "w") else "black"


def is_hourglass(state: dict) -> bool:
    """Партия с «песочными часами» (фора, 21.1): время, потраченное ходящим, прибавляется сопернику."""
    return str(state.get("hourglass") or "") == "1"


def live_clock_ms(state: dict, color: str, now_ms: int) -> int:
    """
    Фактический остаток времени игрока. Часы идут только у стороны, которая ходит, и всегда
    отсчитываются от last_move_at — разрыв соединения на них никак не влияет. В «песочных часах» у ждущей стороны
    время растёт на столько же, на сколько убывает у ходящей.
    """
    stored = int(state[f"{color}_time_ms"])
    elapsed = max(0, now_ms - int(state["last_move_at"]))
    if color != side_to_move(state):
        return stored + elapsed if is_hourglass(state) else stored
    return stored - elapsed


def clocks_after_move(
        mover_ms: int, waiting_ms: int, spent_ms: int, increment_ms: int, hourglass: bool,
) -> tuple[int, int]:
    """
    Часы ходившего и ждавшего после хода (чистое правило). spent_ms — потраченное ходящим время за вычетом
    возвращённого лага; ходивший получает добавку, а в «песочных часах» ждавший получает потраченное ходящим.
    """
    return mover_ms - spent_ms + increment_ms, waiting_ms + (spent_ms if hourglass else 0)


def lag_allowance_ms(state: dict, color: str) -> int:
    """Сколько лага ещё можно вернуть стороне за один ход: остаток квоты партии, но не больше квоты хода."""
    used = int(state.get(f"{color}_lag_ms") or 0)
    return max(0, min(LAG_PER_MOVE_MS, LAG_PER_GAME_MS - used))


def lag_credit_ms(state: dict, color: str, elapsed_ms: int, client_elapsed_ms: int | None) -> int:
    """Возврат времени за ход: лаг (сервер насчитал больше, чем думал клиент) в пределах квоты; без данных — 0."""
    if client_elapsed_ms is None:
        return 0
    return max(0, min(elapsed_ms - max(0, client_elapsed_ms), lag_allowance_ms(state, color)))


def is_berserk(state: dict, color: str) -> bool:
    """Сторона сыграла «берсерк» (33.3): половина базового времени, добавки нет."""
    return str(state.get(f"{color}_berserk") or "") == "1"


def berserk_fields(state: dict) -> dict:
    """Поля снимка партии для клиента: доступен ли берсерк в этой партии и кто его уже сыграл."""
    return {
        "berserk_allowed": state.get("berserk_allowed") == "1",
        "white_berserk": is_berserk(state, "white"),
        "black_berserk": is_berserk(state, "black"),
    }


def abandon_wait_ms(state: dict, color: str, now_ms: int) -> int:
    """Сколько ещё отключённый игрок может отсутствовать до поражения (для отсчёта у соперника)."""
    wait = ABANDON_TIMEOUT_MS
    if color == side_to_move(state):
        wait = min(wait, max(0, live_clock_ms(state, color, now_ms)))
    return wait


def evaluate_clock_expiry(state: dict, now_ms: int) -> tuple[str, int | None, str] | None:
    """
    Чистая проверка флага / брошенной партии по состоянию (уже приведённому _coerce_state).
    Возвращает (result, winner_id, reason) или None, если партия продолжается.

    1. Флаг: у стороны, которая ходит, кончилось время — независимо от того, подключена ли она.
       Флаг падает с отсрочкой на доступную квоту лага (33.3): ход, отправленный вовремя, но
       задержавшийся в сети, ещё может прийти и быть засчитан (process_atomic_move).
    2. Брошенная партия: игрок отключён дольше ABANDON_TIMEOUT_MS (его часы при этом могут
       и не идти, если сейчас ход соперника).
    """
    white_id, black_id = int(state["white_id"]), int(state["black_id"])

    mover = side_to_move(state)
    if live_clock_ms(state, mover, now_ms) + lag_allowance_ms(state, mover) <= 0:
        result, termination = flag_outcome(state.get("board_fen"), mover)
        if result == "1/2-1/2":
            return result, None, termination
        return result, (black_id if mover == "white" else white_id), termination

    for color in ("white", "black"):
        if state.get(f"{color}_disconnected") != "true":
            continue
        started_at = int(state.get(f"{color}_disconnect_started_at") or 0)
        if started_at > 0 and now_ms - started_at >= ABANDON_TIMEOUT_MS:
            stayed = "black" if color == "white" else "white"
            # Как и при флаге: если оставшийся игрок не может поставить мат никакой
            # последовательностью ходов, победу ему не засчитываем — ничья.
            if not side_has_mating_material(state.get("board_fen"), stayed):
                return "1/2-1/2", None, ABANDON_DRAW_TERMINATION
            if color == "white":
                return "0-1", black_id, "abandoned"
            return "1-0", white_id, "abandoned"
    return None


# Сортированное множество «id партии -> ближайший срок проверки часов (мс)»; ведётся через next_timeout_deadline_ms.
GAME_DEADLINES_KEY = "game_deadlines"


def next_timeout_deadline_ms(state: dict) -> int:
    """
    Следующий момент (абсолютные мс), когда у партии может сработать флаг, брошенность или
    неявка на 1-м ходу — минимум применимых дедлайнов. Используется только как score в
    сортированном множестве GAME_DEADLINES_KEY, чтобы check_timeouts_once не перебирал все
    активные партии каждые 0.5 с, а брал через ZRANGEBYSCORE только те, чей срок подошёл.
    Не подменяет evaluate_clock_expiry — та решает исход по актуальному состоянию на момент
    самой проверки, а это только планирование следующего пробуждения.
    """
    last_move_at = int(state.get("last_move_at", 0) or 0)
    mover = side_to_move(state)
    deadlines = [last_move_at + int(state.get(f"{mover}_time_ms", 0) or 0) + lag_allowance_ms(state, mover)]

    if int(state.get("state_version", 0) or 0) < 2:
        deadlines.append(last_move_at + 30000)

    for color in ("white", "black"):
        if state.get(f"{color}_disconnected") == "true":
            started_at = int(state.get(f"{color}_disconnect_started_at", 0) or 0)
            if started_at > 0:
                deadlines.append(started_at + ABANDON_TIMEOUT_MS)

    return min(deadlines)


class GameStateManager:
    """
    Состояние идущих партий в Redis и их завершение (подробно — в описании модуля). Единственный экземпляр —
    state_manager.
    """
    def __init__(self):
        self.redis = redis_client
        # game_id -> (сбоев подряд, не проверять раньше чем, ms) — для проверки таймаутов
        self._timeout_failures: dict[int, tuple[int, int]] = {}
        # Сверка Redis и БД (только у лидера цикла таймаутов): 0 — первый проход сразу при старте.
        self._last_reconcile_ms = 0
        self._missing_state_seen: set[int] = set()

    def _get_key(self, game_id: int) -> str:
        return f"game:{game_id}:state"

    async def initialize_game(
            self, game_id: int, white_id: int, black_id: int, base_time_ms: int, increment_ms: int,
            is_rated: bool = True, start_fen: str | None = None, white_time_ms: int | None = None,
            black_time_ms: int | None = None, arena: dict | None = None, hourglass: bool = False,
    ):
        """
        Создаёт состояние новой партии в Redis, заносит её в active_games, game_deadlines и ставит игрокам
        user:{id}:current_game. Часы — base_time_ms у каждой стороны, если не передано своё время (фора).
        arena — партия арены (33.3): {"arena_id": …, "berserk_allowed": bool} — попадает в состояние партии.
        hourglass — «песочные часы» (фора, 21.1).
        """
        now_ms = int(time.time() * 1000)
        state = {
            "white_id": str(white_id),
            "black_id": str(black_id),
            "is_rated": "1" if is_rated else "0",
            "board_fen": start_fen or STARTING_FEN,
            # Партия с позиции (фора): PGN начинается с заголовков SetUp/FEN.
            "pgn": pgn_header(start_fen) if start_fen else "",
            "state_version": "0",
            "white_time_ms": str(white_time_ms if white_time_ms is not None else base_time_ms),
            "black_time_ms": str(black_time_ms if black_time_ms is not None else base_time_ms),
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
            "hourglass": "1" if hourglass else "0",
        }
        if arena:
            state["arena_id"] = str(arena["arena_id"])
            state["berserk_allowed"] = "1" if arena.get("berserk_allowed") else "0"
        await self.redis.hset(self._get_key(game_id), mapping=state)
        await self.redis.sadd("active_games", str(game_id))
        await self.redis.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms(state)})
        await self.redis.set(f"user:{white_id}:current_game", str(game_id))
        await self.redis.set(f"user:{black_id}:current_game", str(game_id))

    init_game = initialize_game  # прежнее имя метода, оставленное для совместимости (в src/ не используется)

    async def get_active_game_id(self, user_id: int) -> int | None:
        """
        id партии, которую игрок сейчас играет, или None. Устаревшую ссылку
        user:{id}:current_game (партия уже завершена) заодно удаляет.
        """
        key = f"user:{int(user_id)}:current_game"
        raw = await self.redis.get(key)
        if not raw:
            return None
        game_id = int(raw)
        state = await self.get_game_state(game_id)
        if state and state.get("status") == "in_progress" and int(user_id) in (
                int(state["white_id"]), int(state["black_id"])):
            return game_id
        if await self.redis.get(key) == raw:
            await self.redis.delete(key)
        return None

    async def get_game_state(self, game_id: int) -> dict | None:
        """Состояние партии из Redis (числа приведены к int); если хэша нет — восстановление из БД или None."""
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
        При захвате партия попадает в реестр PENDING_FINISH_KEY (для сверки) и уходит из game_deadlines.

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

                    ended_at = int(time.time() * 1000)
                    pipe.multi()
                    pipe.hset(game_key, mapping={
                        "status": status,
                        "result": result,
                        "termination": termination,
                        "ended_at": str(ended_at),
                    })
                    pipe.zadd(PENDING_FINISH_KEY, {str(game_id): ended_at})
                    pipe.zrem(GAME_DEADLINES_KEY, str(game_id))
                    await pipe.execute()
                    return state
                except WatchError:
                    continue

    async def _recover_state_from_db(self, game_id: int) -> dict | None:
        """
        Восстанавливает хэш состояния партии в Redis из таблицы games (отключения, предложения ничьей и реванша не
        сохраняются). Для идущей партии заново ставит active_games, срок проверки и ссылки игроков; для
        завершённой — срок жизни хэша. Возвращает состояние или None, если партии нет в БД или произошёл сбой.
        """
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
                    "is_rated": "1" if db_game.is_rated else "0",
                    "board_fen": db_game.board_fen or STARTING_FEN,
                    "pgn": db_game.pgn or (pgn_header(db_game.initial_fen) if db_game.initial_fen else ""),
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
                    "hourglass": "1" if db_game.hourglass else "0",
                }
                if status_str == "in_progress":
                    # Партия арены: без этих полей берсерк после восстановления снова получал бы добавку.
                    from src.services import arena as arena_service
                    state.update(await arena_service.game_state_fields(db, game_id))
                await self.redis.hset(self._get_key(game_id), mapping=state)
                if status_str != "in_progress":
                    # Завершённую партию восстанавливают ради реванша и чата после игры —
                    # без срока жизни такие хэши копились бы в Redis бесконечно.
                    await self.redis.expire(self._get_key(game_id), FINISHED_STATE_TTL_S)
                if status_str == "in_progress":
                    await self.redis.sadd("active_games", str(game_id))
                    await self.redis.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms(state)})
                    await self.redis.set(f"user:{db_game.white_player_id}:current_game", str(game_id))
                    await self.redis.set(f"user:{db_game.black_player_id}:current_game", str(game_id))
                return await self.get_game_state(game_id)
        except Exception as e:
            logger.error("Failed to recover game %s from DB: %s", game_id, e)
            return None

    async def update_game_state(self, game_id: int, updates: dict):
        """Записывает поля в хэш партии без проверки статуса; для идущей партии лучше update_if_in_progress."""
        str_updates = {k: str(v) for k, v in updates.items()}
        await self.redis.hset(self._get_key(game_id), mapping=str_updates)

    async def clear_game_state(self, game_id: int):
        """
        Убирает партию из Redis после записи итога: состояние, журналы команд и ходов, отметки «игрок в партии», срок
        проверки часов.
        """
        state = await self.redis.hgetall(self._get_key(game_id))
        if state:
            await self.redis.delete(f"user:{state.get('white_id')}:current_game")
            await self.redis.delete(f"user:{state.get('black_id')}:current_game")
        await self.redis.delete(self._get_key(game_id))
        await self.redis.delete(f"game:{game_id}:commands")
        await self.redis.delete(f"game:{game_id}:moves")
        await self.redis.srem("active_games", str(game_id))
        await self.redis.zrem(GAME_DEADLINES_KEY, str(game_id))

    async def save_move_telemetry(self, game_id: int, move_data: dict):
        """Дописывает в журнал game:{id}:moves телеметрию хода; в таблицу moves она попадёт при finish_game."""
        key = f"game:{game_id}:moves"
        await self.redis.rpush(key, json.dumps(move_data))

    async def read_all_moves(self, game_id: int) -> list[dict]:
        """
        Телеметрия ходов партии. Не удаляет её: удаление — после коммита итога в БД
        (clear_game_state), иначе при сбое коммита повторная попытка осталась бы без ходов.
        """
        moves_raw = await self.redis.lrange(f"game:{game_id}:moves", 0, -1)
        return [json.loads(m) for m in moves_raw]

    async def _mark_finished_in_db(self, game_id: int) -> None:
        """Итог партии записан в БД — сверке её дозавершать больше не нужно."""
        await self.redis.zrem(PENDING_FINISH_KEY, str(game_id))

    async def process_atomic_move(
            self,
            game_id: int,
            user_id: int,
            command_id: str,
            move_str: str,
            expected_version: int | None = None,
            client_elapsed_ms: int | None = None,
    ) -> dict:
        """
        Атомарно (WATCH/MULTI) применяет ход игрока: повтор command_id, версия, очередь хода, легальность,
        списание времени и квота лага, смена позиции, снятие чужого предложения ничьей.
        Возвращает словарь со status: "success" (ход принят), "game_over" (мат, ничья или флаг, партия уже
        закрыта в Redis, но не в БД), "ignored" (повтор команды) или "error" с кодом в reason; при отказе игрока
        в ответ кладётся актуальная позиция.
        client_elapsed_ms — время обдумывания хода по часам клиента: разница с часами сервера — лаг, который
        возвращается игроку в пределах квоты (lag_credit_ms). None — возврата нет.
        """
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
                        return _move_rejection("version_mismatch", state)

                    turn = state.get("turn", "white")
                    white_id = int(state["white_id"])
                    black_id = int(state["black_id"])

                    is_white_turn = turn in ("white", "w")
                    expected_player_id = white_id if is_white_turn else black_id

                    if user_id != expected_player_id:
                        await pipe.unwatch()
                        if user_id not in (white_id, black_id):
                            # Посторонним (зрителям) позицию в ответе не возвращаем.
                            return {"status": "error", "reason": "not_your_turn"}
                        return _move_rejection("not_your_turn", state)

                    now_ms = int(time.time() * 1000)
                    last_move_at = int(state["last_move_at"])
                    elapsed_ms = max(0, now_ms - last_move_at)

                    mover = "white" if is_white_turn else "black"
                    # Берсерк (33.3) играет без добавки.
                    increment = 0 if is_berserk(state, mover) else int(state["increment_ms"])
                    white_time = int(state["white_time_ms"])
                    black_time = int(state["black_time_ms"])

                    lag_credit = lag_credit_ms(state, mover, elapsed_ms, client_elapsed_ms)
                    lag_used = int(state.get(f"{mover}_lag_ms") or 0) + lag_credit
                    remaining_after_move = (white_time if is_white_turn else black_time) - elapsed_ms + lag_credit
                    if remaining_after_move <= 0:
                        # Флаг упал до хода: завершаем партию в той же транзакции, чтобы
                        # check_timeouts_loop или другой обработчик не завершили её повторно.
                        flag_result, flag_termination = flag_outcome(
                            state.get("board_fen"), "white" if is_white_turn else "black",
                        )
                        # В «песочных часах» всё время упавшего уже перешло сопернику.
                        gain = (white_time if is_white_turn else black_time) if is_hourglass(state) else 0
                        final_white = 0 if is_white_turn else white_time + gain
                        final_black = black_time + gain if is_white_turn else 0
                        pipe.multi()
                        pipe.hset(game_key, mapping={
                            "status": "completed",
                            "result": flag_result,
                            "termination": flag_termination,
                            "white_time_ms": str(final_white),
                            "black_time_ms": str(final_black),
                            "ended_at": str(now_ms),
                        })
                        pipe.zadd(PENDING_FINISH_KEY, {str(game_id): now_ms})
                        pipe.zrem(GAME_DEADLINES_KEY, str(game_id))
                        pipe.sadd(cmd_key, command_id)
                        await pipe.execute()
                        return {
                            "status": "game_over",
                            "result": flag_result,
                            "termination": flag_termination,
                            "white_id": white_id,
                            "black_id": black_id,
                            "white_time_ms": final_white,
                            "black_time_ms": final_black,
                            "elapsed_ms": elapsed_ms,
                        }

                    mover_time, waiting_time = clocks_after_move(
                        white_time if is_white_turn else black_time, black_time if is_white_turn else white_time,
                        elapsed_ms - lag_credit, increment, is_hourglass(state),
                    )
                    new_white_time, new_black_time = (
                        (mover_time, waiting_time) if is_white_turn else (waiting_time, mover_time)
                    )

                    current_fen = state.get("board_fen") or STARTING_FEN
                    current_pgn = state.get("pgn") or ""

                    is_valid, move_data = engine.process_move(current_fen, move_str, current_pgn)
                    if not is_valid or not move_data:
                        await pipe.unwatch()
                        return _move_rejection("illegal_move", state)

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
                            "ended_at": str(now_ms),
                            f"{mover}_lag_ms": str(lag_used),
                        }
                        pipe.hset(game_key, mapping=updates)
                        pipe.zadd(PENDING_FINISH_KEY, {str(game_id): now_ms})
                        pipe.zrem(GAME_DEADLINES_KEY, str(game_id))
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
                        f"{mover}_lag_ms": str(lag_used),
                    }
                    # Предложение ничьей действует, пока соперник не ответил ходом (ФИДЕ 9.1.2):
                    # ход того, кому предложили, его отклоняет; свой ход предложившего — нет.
                    draw_offer = str(state.get("draw_offer") or "")
                    if draw_offer and draw_offer != str(user_id):
                        updates["draw_offer"] = ""

                    pipe.hset(game_key, mapping=updates)
                    pipe.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms({**state, **updates})})
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
                        "lag_credit_ms": lag_credit,
                        "now_ms": now_ms,
                    }

                except WatchError:
                    continue

    async def apply_berserk(self, game_id: int, user_id: int) -> dict:
        """
        «Берсерк» (33.3): до своего первого хода игрок партии арены оставляет себе половину базового времени и
        отказывается от добавки (за победу арена даст лишнее очко — src/services/arena.py). Атомарно (WATCH/MULTI):
        ход, сделанный в тот же момент, либо опередит берсерк (тогда отказ), либо увидит уже новые часы.

        Возвращает {"status": "ok", "color", "state"} со свежим состоянием или {"status": "error", "code"};
        повторный берсерк — {"status": "ignored"}.
        """
        game_key = self._get_key(game_id)
        async with self.redis.pipeline(transaction=True) as pipe:
            while True:
                try:
                    await pipe.watch(game_key)
                    raw = await pipe.hgetall(game_key)
                    if not raw or raw.get("status") != "in_progress":
                        await pipe.unwatch()
                        return {"status": "error", "code": "game_not_in_progress"}
                    state = _coerce_state(raw)
                    if user_id not in (state["white_id"], state["black_id"]) or state.get("berserk_allowed") != "1":
                        await pipe.unwatch()
                        return {"status": "error", "code": "berserk_unavailable"}
                    color = "white" if user_id == state["white_id"] else "black"
                    if is_berserk(state, color):
                        await pipe.unwatch()
                        return {"status": "ignored"}
                    now_ms = int(time.time() * 1000)
                    half = int(state["base_time_ms"]) // 2
                    updates = {f"{color}_time_ms": str(half), f"{color}_berserk": "1"}
                    fresh = {**state, f"{color}_time_ms": half, f"{color}_berserk": "1"}
                    # Белые ещё не ходили при версии 0, чёрные — при версии не больше 1.
                    moved = int(state.get("state_version", 0)) > (0 if color == "white" else 1)
                    if moved or live_clock_ms(fresh, color, now_ms) <= 0:
                        await pipe.unwatch()
                        return {"status": "error", "code": "berserk_too_late"}
                    pipe.multi()
                    pipe.hset(game_key, mapping=updates)
                    pipe.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms(fresh)})
                    await pipe.execute()
                    return {"status": "ok", "color": color, "state": fresh}
                except WatchError:
                    continue

    async def sync_authoritative_state_to_db(self, db, game_id: int, res: dict):
        """
        Копирует состояние после хода в таблицу games (позиция, запись ходов, версия, очередь хода, часы): по ней
        партия восстановится, если пропадёт из Redis.
        """
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
                          final_pgn: str | None = None) -> dict:
        """
        Фиксирует итог партии в БД: рейтинги по категории контроля (если партия рейтинговая), ходы с телеметрией,
        PGN, ECO, события продукта, очки арены, оценку античита, очистку Redis и постановку разбора в фон.
        Возвращает изменения и новые рейтинги игроков (для уже записанной партии — только изменения).

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
            # Итог уже записан (повторный вызов или сверка после сбоя между коммитом и
            # очисткой Redis) — достаточно убрать остатки состояния.
            await self._mark_finished_in_db(game_id)
            await self.clear_game_state(game_id)
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

        # Рейтинг и число сыгранных партий — отдельно по категории контроля времени этой
        # партии (пуля/блиц/рапид/классика), а не один общий счёт.
        category = classify_time_control(db_game.base_time_ms, db_game.increment_ms)
        white_initial = white_user.rating_for(category)
        black_initial = black_user.rating_for(category)
        delta_w = delta_b = 0
        new_w = white_initial
        new_b = black_initial

        if db_game.is_rated:
            white_games_count = white_user.games_played_for(category)
            black_games_count = black_user.games_played_for(category)

            new_w, delta_w, new_b, delta_b = elo_calculator.calculate_new_ratings(
                white_initial,
                black_initial,
                result,
                white_games=white_games_count,
                black_games=black_games_count,
            )
            setattr(white_user, f"{category}_rating", new_w)
            setattr(black_user, f"{category}_rating", new_b)
            setattr(white_user, f"{category}_games_played", white_games_count + 1)
            setattr(black_user, f"{category}_games_played", black_games_count + 1)

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

        today_str = datetime.datetime.now(datetime.UTC).strftime("%Y.%m.%d")
        db_game.status = GameStatus.COMPLETED
        db_game.finished_at = func.now()
        db_game.pgn_date = today_str
        db_game.site = "Regence"

        moves_telemetry = await self.read_all_moves(game_id)
        if moves_telemetry:
            db_moves = [Move(game_id=game_id, **m) for m in moves_telemetry]
            db.add_all(db_moves)

            uci_seq = [m.get("notation", "") for m in moves_telemetry if m.get("notation")]
            eco_code = openings.eco_code(uci_seq)
            db_game.eco = eco_code

            pgn_game = chess.pgn.Game()
            pgn_game.headers["Event"] = "Regence Rated Game" if db_game.is_rated else "Regence Casual Game"
            pgn_game.headers["Site"] = "Regence"
            pgn_game.headers["Date"] = today_str
            pgn_game.headers["White"] = white_user.username
            pgn_game.headers["Black"] = black_user.username
            pgn_game.headers["WhiteElo"] = str(white_initial)
            pgn_game.headers["BlackElo"] = str(black_initial)
            pgn_game.headers["Result"] = result
            pgn_game.headers["ECO"] = eco_code
            pgn_game.headers["TimeControl"] = f"{db_game.base_time_ms // 1000}+{db_game.increment_ms // 1000}"
            pgn_game.headers["Termination"] = termination

            node: chess.pgn.GameNode = pgn_game
            if db_game.initial_fen:
                pgn_game.setup(board_from_fen(db_game.initial_fen))  # у партии 960 — и заголовок Variant
            board_for_pgn = board_from_fen(db_game.initial_fen) if db_game.initial_fen else chess.Board()
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

        for player in (white_user, black_user):
            if player is not None and not player.is_bot:
                await product_metrics.record_event(db, player.id, product_metrics.GAME_FINISHED)
        # Партия арены (17.2): очки и серии участников — в той же транзакции, что и итог партии.
        from src.services import arena as arena_service
        await arena_service.on_game_finished(db, game_id, result, termination=termination,
                                             plies=len(moves_telemetry) if moves_telemetry else 0)
        await db.commit()
        await self._mark_finished_in_db(game_id)
        GAMES_FINISHED.labels(bounded_label(termination)).inc()

        if db_game.is_rated:
            try:
                await evaluate_game_telemetry(db, game_id)
            except Exception as ac_err:
                logger.error("Telemetry anti-cheat evaluation failed for game %s: %s", game_id, ac_err)

        await self.clear_game_state(game_id)

        # Швейцарка между людьми (17.2): следующий тур — когда игроки уже свободны.
        try:
            await arena_service.advance_after_game(db, game_id)
        except Exception as arena_err:
            logger.error("Arena round advance failed after game %s: %s", game_id, arena_err)

        # Не ждём брокер: публикация идёт в потоке, итог партии рассылается сразу.
        schedule_game_analysis_in_background(game_id)

        return {
            "white_delta": delta_w,
            "black_delta": delta_b,
            "white_new_rating": new_w,
            "black_new_rating": new_b
        }

    async def handle_player_disconnect(self, user_id: int, manager):
        """
        Игрок отключился во время партии: в состоянии ставится отметка и момент отключения, сопернику сообщается,
        сколько осталось ждать до поражения отключившегося. Часы продолжают идти.
        manager — менеджер соединений (connection_manager), через него идёт сообщение сопернику.
        """
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
        fresh = await self._update_if_in_progress(game_id, {
            f"{color}_disconnected": "true",
            f"{color}_disconnect_started_at": str(now_ms),
        })
        if fresh is None:
            return

        await manager.send_personal_message(
            {
                "event": "opponent_disconnected",
                "game_id": game_id,
                "max_wait_ms": abandon_wait_ms(fresh, color, now_ms),
            },
            opponent_id,
        )

    async def handle_player_reconnect(self, user_id: int, manager):
        """
        Игрок вернулся в партию: отметка отключения снимается, соперник получает уведомление. Часы не трогаются — они
        шли всё это время.
        """
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
            # Часы не трогаем: они и так шли от last_move_at, пока игрок был офлайн.
            # Раньше здесь сдвигался last_move_at, и если был ход соперника, его часы
            # фактически стояли всё время отключения.
            fresh = await self._update_if_in_progress(game_id, {
                f"{color}_disconnected": "false",
                f"{color}_disconnect_started_at": "0",
            })
            if fresh is not None:
                await manager.send_personal_message(
                    {"event": "opponent_reconnected", "game_id": game_id}, opponent_id,
                )

    async def update_if_in_progress(self, game_id: int, updates: dict) -> dict | None:
        """Обновляет поля идущей партии; None, если она уже завершена (см. _update_if_in_progress)."""
        return await self._update_if_in_progress(game_id, updates)

    async def _update_if_in_progress(self, game_id: int, updates: dict) -> dict | None:
        """
        Атомарно (WATCH/MULTI) обновляет поля партии, только пока она in_progress.
        Обычный hset после clear_game_state воссоздал бы «огрызок» хэша без white_id и т.п.
        Заодно пересчитывает срок в game_deadlines (меняются отметки отключения, берсерк и т. п.).
        Возвращает состояние до обновления или None, если партия уже не идёт.
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
                    str_updates = {k: str(v) for k, v in updates.items()}
                    pipe.multi()
                    pipe.hset(game_key, mapping=str_updates)
                    pipe.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms({**raw, **str_updates})})
                    await pipe.execute()
                    return _coerce_state(raw)
                except WatchError:
                    continue

    async def _hold_timeouts_leadership(self) -> bool:
        """
        Цикл таймаутов выполняет только один воркер (лидер). Лидерство — ключ с TTL; лидер
        продлевает его каждую итерацию, при падении лидера ключ истекает и его берёт другой.
        Даже если на мгновение лидеров окажется двое, двойного завершения партии не будет:
        оно защищено claim_game_end. Если Redis недоступен, возвращает True: проход всё равно запускается.
        """
        try:
            if await self.redis.set(TIMEOUTS_LEADER_KEY, WORKER_ID, nx=True, px=TIMEOUTS_LEADER_TTL_MS):
                return True
            if await self.redis.get(TIMEOUTS_LEADER_KEY) == WORKER_ID:
                await self.redis.pexpire(TIMEOUTS_LEADER_KEY, TIMEOUTS_LEADER_TTL_MS)
                return True
            return False
        except Exception as exc:
            logger.warning("Timeouts leadership check failed, running loop anyway: %s", exc)
            return True

    async def check_timeouts_loop(self, manager):
        """
        Бесконечный цикл, раз в полсекунды: если этот процесс — лидер, проверяет партии с подошедшим сроком (флаг,
        неявка, брошенная партия) и периодически сверяет Redis с базой.
        """
        while True:
            try:
                if await self._hold_timeouts_leadership():
                    await self.check_timeouts_once(manager)
                    await self._maybe_reconcile(manager)
            except Exception:
                # Сюда попадают только сбои самого прохода (Redis недоступен и т. п.);
                # ошибки отдельных партий изолированы в check_timeouts_once.
                logger.exception("Error in check_timeouts_loop")

            await asyncio.sleep(0.5)

    async def check_timeouts_once(self, manager, now_ms: int | None = None) -> None:
        """
        Один проход: флаги, брошенные партии, неявка на первый ход — но не по всем активным
        партиям, а только по тем, чей дедлайн (GAME_DEADLINES_KEY) уже подошёл. При сотнях
        одновременных партий большинство не близко к флагу, и полный перебор active_games
        каждые 0.5 с не масштабируется; ZRANGEBYSCORE достаёт ровно те, кому пора.

        Каждая партия обрабатывается в собственном try: раньше исключение на одной «битой»
        партии (повреждённое состояние, сбой БД в finish_game) прерывало весь проход, и на каждом
        тике всё повторялось — флаги и отмены переставали срабатывать во всех партиях сразу.
        Партия, которая падает раз за разом, откладывается с растущей паузой, но не выбрасывается:
        при временном сбое БД иначе потерялись бы все идущие партии.
        """
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        due_game_ids = await self.redis.zrangebyscore(GAME_DEADLINES_KEY, 0, now_ms)

        # Счётчики сбоев партий, которые уже не активны (завершены другим путём), не нужны.
        # active_games, а не due_game_ids: партия с ещё не подошедшим дедлайном не должна
        # терять накопленный backoff только из-за того, что в этот тик её не разбирали.
        for stale_id in list(self._timeout_failures):
            if not await self.redis.sismember("active_games", str(stale_id)):
                del self._timeout_failures[stale_id]

        for game_id_str in due_game_ids:
            try:
                game_id = int(game_id_str)
            except (TypeError, ValueError):
                logger.error("Removing malformed id %r from %s", game_id_str, GAME_DEADLINES_KEY)
                await self.redis.zrem(GAME_DEADLINES_KEY, game_id_str)
                continue

            failure = self._timeout_failures.get(game_id)
            if failure and now_ms < failure[1]:
                continue  # пауза после повторяющихся сбоев ещё не прошла

            try:
                await self._check_game_timeout(game_id, game_id_str, manager, now_ms)
            except Exception:
                self._record_timeout_failure(game_id, now_ms)
            else:
                self._timeout_failures.pop(game_id, None)

    async def _maybe_reconcile(self, manager) -> None:
        """Запускает сверку Redis и БД не чаще, чем раз в RECONCILE_INTERVAL_MS."""
        now_ms = int(time.time() * 1000)
        if now_ms - self._last_reconcile_ms < RECONCILE_INTERVAL_MS:
            return
        # Время отмечаем до прохода: упавшая сверка не должна повторяться каждые полсекунды.
        self._last_reconcile_ms = now_ms
        await self.reconcile_unfinished_games(now_ms, manager=manager)

    def _record_timeout_failure(self, game_id: int, now_ms: int) -> None:
        """Считает сбой проверки партии и откладывает следующую попытку (экспоненциально, не дольше TIMEOUT_RETRY_MAX_MS)."""
        TIMEOUT_CHECK_FAILURES.inc()
        count = self._timeout_failures.get(game_id, (0, 0))[0] + 1
        delay_ms = min(TIMEOUT_RETRY_MAX_MS, TIMEOUT_RETRY_BASE_MS * 2 ** (count - 1))
        self._timeout_failures[game_id] = (count, now_ms + delay_ms)
        # Полный стек — на первом сбое и затем изредка, чтобы не заливать лог каждые полсекунды.
        if count == 1 or count % TIMEOUT_FAILURE_LOG_EVERY == 0:
            logger.exception(
                "Timeout check failed for game %s (%s in a row), next attempt in %s ms",
                game_id, count, delay_ms,
            )

    async def _check_game_timeout(self, game_id: int, game_id_str: str, manager, now_ms: int) -> None:
        """
        Проверка одной партии с подошедшим сроком: неявка на первый ход (30 с) — отмена, иначе флаг или брошенная
        партия по evaluate_clock_expiry — захват, запись итога и рассылка game_over игрокам и зрителям.
        """
        state = await self.get_game_state(game_id)
        if not state or state["status"] != "in_progress":
            await self.redis.srem("active_games", game_id_str)
            await self.redis.zrem(GAME_DEADLINES_KEY, game_id_str)
            return

        if int(state.get("state_version", 0)) < 2 and now_ms - int(state.get("last_move_at", now_ms)) >= 30000:
            async with AsyncSessionLocal() as db:
                await self.check_first_move_abort_timeout(db, game_id, manager=manager, timeout_ms=30000)
            return

        white_id, black_id = int(state["white_id"]), int(state["black_id"])
        decision = evaluate_clock_expiry(state, now_ms)
        if not decision:
            # Дедлайн в GAME_DEADLINES_KEY подошёл, но на свежем состоянии исход не сработал
            # (например, ход и наш тик пересеклись) — переставляем его на будущий момент,
            # иначе эта партия будет попадать в ZRANGEBYSCORE на каждом тике без дела.
            await self.redis.zadd(GAME_DEADLINES_KEY, {game_id_str: next_timeout_deadline_ms(state)})
            return

        game_result, winner_id, reason = decision

        # Решение перепроверяется на свежем состоянии внутри транзакции: игрок мог
        # успеть сходить, переподключиться или сдаться, пока мы читали состояние.
        claimed = await self.claim_game_end(
            game_id, game_result, reason,
            guard=lambda fresh, expected=decision: evaluate_clock_expiry(fresh, now_ms) == expected,
        )
        if not claimed:
            return

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

    async def abort_game(self, db, game_id: int, guard=None) -> dict:
        """
        Отменяет партию на 1-м ходу (до 2 полуходов) без изменения рейтинга.
        guard(state) -> bool — дополнительное условие, атомарно перепроверяемое при захвате.
        Возвращает {"status": "aborted", ...} с id и рейтингами игроков либо {"status": "error", "code"}.
        """
        state = await self.get_game_state(game_id)
        if not state or state.get("status") != "in_progress":
            return {"status": "error", "reason": "Game is not in progress", "code": "game_not_in_progress"}

        state_version = int(state.get("state_version", 0))
        if state_version >= 2:
            return {"status": "error", "reason": "Cannot abort game after move 1", "code": "abort_too_late"}

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
            return {"status": "error", "reason": "Game is not in progress", "code": "game_not_in_progress"}

        await self.redis.srem("active_games", str(game_id))
        await self.redis.delete(f"user:{white_id}:current_game")
        await self.redis.delete(f"user:{black_id}:current_game")

        # Партия арены (33.1): отмена до первых ходов — неявка того, чья очередь ходить (добровольная отмена в арене
        # запрещена на входе, сюда приходит только таймаут первого хода).
        no_show = "white" if state_version == 0 else "black"
        w_rating, b_rating = await self._finalize_abort_in_db(db, game_id, white_id, black_id, no_show=no_show)

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

    async def _finalize_abort_in_db(self, db, game_id: int, white_id: int, black_id: int,
                                    no_show: str | None = None) -> tuple[int, int]:
        """
        Записывает отмену партии в БД (идемпотентно). Вызывается после успешного захвата
        завершения со статусом aborted — из abort_game или из сверки после сбоя.
        Возвращает текущие рейтинги игроков (отмена их не меняет).
        """
        from datetime import datetime

        db_game = await db.get(Game, game_id, with_for_update=True, populate_existing=True)
        white_user = await db.get(User, white_id)
        black_user = await db.get(User, black_id)

        category = classify_time_control(db_game.base_time_ms, db_game.increment_ms) if db_game else "blitz"
        w_rating = white_user.rating_for(category) if white_user else 1200
        b_rating = black_user.rating_for(category) if black_user else 1200

        if db_game and db_game.status not in (GameStatus.COMPLETED, GameStatus.ABORTED):
            db_game.status = GameStatus.ABORTED
            db_game.result = "*"
            db_game.termination = "aborted"
            db_game.white_rating_delta = 0
            db_game.black_rating_delta = 0
            is_tz = getattr(Game.__table__.c.finished_at.type, "timezone", False)
            now_utc = datetime.now(UTC)
            db_game.finished_at = now_utc if is_tz else now_utc.replace(tzinfo=None)
            # Арена: неявка — поражение не сделавшему первый ход; сторона неизвестна (сверка) — партия без очков.
            from src.services import arena as arena_service
            await arena_service.on_game_aborted(db, game_id, no_show)
        await db.commit()  # и снимает блокировку, если партия уже была завершена
        await self._mark_finished_in_db(game_id)
        return w_rating, b_rating

    # --- Сверка Redis и БД ----------------------------------------------------------------

    async def reconcile_unfinished_games(self, now_ms: int | None = None, manager=None) -> dict:
        """
        Дозавершает партии, застрявшие между Redis и БД.

        1. Партия завершена в Redis (claim_game_end / мат / флаг при ходе), но итог не записан
           в БД: процесс упал или БД была недоступна между этими шагами. Без сверки партия
           навсегда оставалась бы in_progress в БД без рейтинга, а цикл таймаутов её уже не видит.
           Такие партии лежат в PENDING_FINISH_KEY; берём те, что висят дольше RECONCILE_GRACE_MS
           (штатный обработчик к этому моменту давно бы закончил) и прогоняем через
           идемпотентные finish_game / _finalize_abort_in_db.
        2. Партия in_progress в БД, но в Redis её состояния нет (Redis перезапущен без
           персистентности) или она выпала из active_games: восстанавливаем состояние, чтобы
           работали ходы и часы. Состояние должно отсутствовать на двух проходах подряд —
           иначе можно поймать только что созданную партию до initialize_game.
        """
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        report: dict[str, list[int]] = {"finished": [], "aborted": [], "restored": [], "failed": []}

        overdue = await self.redis.zrangebyscore(PENDING_FINISH_KEY, 0, now_ms - RECONCILE_GRACE_MS)
        for game_id_str in overdue:
            game_id = int(game_id_str)
            try:
                outcome = await self._finish_pending_game(game_id, manager)
            except Exception:
                logger.exception("Reconciliation could not finish game %s; will retry", game_id)
                report["failed"].append(game_id)
                continue
            if outcome:
                report[outcome].append(game_id)

        async with AsyncSessionLocal() as db:
            rows = await db.execute(select(Game.id).where(Game.status == GameStatus.IN_PROGRESS))
            db_in_progress = [row[0] for row in rows.all()]

        active = {str(gid) for gid in await self.redis.smembers("active_games")}
        missing_now: set[int] = set()
        for game_id in db_in_progress:
            raw = await self.redis.hgetall(self._get_key(game_id))
            if not raw:
                if game_id in self._missing_state_seen:
                    if await self._recover_state_from_db(game_id):
                        report["restored"].append(game_id)
                else:
                    missing_now.add(game_id)
            elif raw.get("status") == "in_progress":
                if str(game_id) not in active:
                    await self.redis.sadd("active_games", str(game_id))
                    report["restored"].append(game_id)
                # Партия активна, но для неё нет дедлайна (деплой этой схемы на уже идущие
                # партии, либо дедлайн потерялся по другой причине) — без него флаг у неё
                # никогда не сработал бы, пока не случится следующий ход/дисконнект.
                if await self.redis.zscore(GAME_DEADLINES_KEY, str(game_id)) is None:
                    await self.redis.zadd(GAME_DEADLINES_KEY, {str(game_id): next_timeout_deadline_ms(raw)})
            elif raw.get("status") in ("completed", "aborted"):
                # Завершена в Redis, но в реестре незавершённых её нет (например, захвачена
                # до появления реестра) — ставим в очередь сверки.
                ended_at = int(raw.get("ended_at") or now_ms)
                await self.redis.zadd(PENDING_FINISH_KEY, {str(game_id): ended_at}, nx=True)
        self._missing_state_seen = missing_now

        if any(report.values()):
            logger.warning("Reconciliation report: %s", report)
        return report

    async def _finish_pending_game(self, game_id: int, manager=None) -> str | None:
        """
        Дозавершает одну партию из реестра сверки по её итогу в Redis и оповещает игроков.
        Возвращает "finished", "aborted" или None, если дозавершать нечего (запись из реестра снята).
        """
        raw = await self.redis.hgetall(self._get_key(game_id))
        status = raw.get("status") if raw else None

        if status == "completed":
            result = raw.get("result") or "1/2-1/2"
            termination = raw.get("termination") or "unknown"
            async with AsyncSessionLocal() as db:
                rating_updates = await self.finish_game(db, game_id, result, termination=termination)
            # Штатный обработчик не успел разослать итог — сообщаем игрокам сами
            # (повторное game_over клиент переживёт, а без него партия «висит» на экране).
            await self._notify_reconciled(manager, raw, {
                "event": "game_over", "game_id": game_id, "reason": termination, "result": result,
                **rating_updates,
            })
            return "finished"
        if status == "aborted":
            white_id, black_id = int(raw["white_id"]), int(raw["black_id"])
            async with AsyncSessionLocal() as db:
                w_rating, b_rating = await self._finalize_abort_in_db(db, game_id, white_id, black_id)
            await self.clear_game_state(game_id)
            await self._notify_reconciled(manager, raw, {
                "event": "game_over", "game_id": game_id, "reason": "aborted", "result": "*",
                "white_delta": 0, "black_delta": 0,
                "white_new_rating": w_rating, "black_new_rating": b_rating,
            })
            return "aborted"

        # Состояния нет (Redis потерян) или партия снова in_progress — дозавершать нечего:
        # итог неизвестен, партию при необходимости восстановит вторая часть сверки.
        await self.redis.zrem(PENDING_FINISH_KEY, str(game_id))
        return None

    @staticmethod
    async def _notify_reconciled(manager, raw_state: dict, payload: dict) -> None:
        """Рассылает итог игрокам и зрителям дозавершённой партии; без менеджера соединений ничего не делает."""
        if manager is None:
            return
        for key in ("white_id", "black_id"):
            await manager.send_personal_message(payload, int(raw_state[key]))
        if hasattr(manager, "broadcast_to_spectators"):
            await manager.broadcast_to_spectators(payload["game_id"], payload)

    async def check_first_move_abort_timeout(self, db, game_id: int, manager=None, timeout_ms: int = 30000) -> bool:
        """
        Проверяет, не истекли ли timeout_ms (по умолчанию 30 с) на первые 2 полухода партии; если истекли —
        отменяет партию (abort_game) и рассылает game_over. Возвращает True, если партия отменена.
        """
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
