# --- FILE: src/services/matchmaker.py ---
"""
Лобби, автоподбор, приватные приглашения и старт PvP-партий.

Инварианты:
- игрок не может участвовать в двух партиях одновременно: перед стартом проверяется
  активная партия обоих, а сами игроки на время создания партии резервируются в Redis
  (SET NX), чтобы две вкладки / два воркера не стартовали параллельно две партии;
- рейтинг берётся из БД в момент подбора, а не из объекта пользователя, закэшированного
  долгоживущей WebSocket-сессией;
- диапазон рейтинга вызова соблюдается: автоподбор сводит только взаимно подходящих игроков,
  при ручном принятии рейтинг принимающего должен попадать в диапазон вызова.

Атомарность между воркерами обеспечивает Redis: вызов и приглашение «захватывает» тот,
чей DELETE ключа вернул 1.
"""

import json
import logging
import random
import secrets
import time
import uuid
from contextlib import asynccontextmanager

import chess
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import RatingCategory, User
from src.services.rating import classify_time_control

logger = logging.getLogger(__name__)

RESERVATION_TTL_MS = 15_000
INVITE_TTL_S = 900
UNBOUNDED_MAX_RATING = 10_000

MIN_BASE_TIME_MS = 15_000
MAX_BASE_TIME_MS = 3 * 60 * 60 * 1000
MAX_INCREMENT_MS = 180_000


class MatchmakingError(Exception):
    """Ожидаемый отказ матчмейкинга с кодом для клиента и сообщением для игрока."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def default_rating_window(rating: int) -> tuple[int, int]:
    """Диапазон по умолчанию, если клиент не прислал свой (0 в настройке — без ограничения)."""
    spread = int(settings.MATCHMAKING_DEFAULT_RATING_RANGE)
    if spread <= 0:
        return 0, UNBOUNDED_MAX_RATING
    return max(0, rating - spread), rating + spread


def normalize_rating_window(min_rating, max_rating, rating: int) -> tuple[int, int]:
    default_min, default_max = default_rating_window(rating)
    lo = default_min if min_rating is None else max(0, int(min_rating))
    hi = default_max if max_rating is None else max(0, int(max_rating))
    return (lo, hi) if lo <= hi else (hi, lo)


def validate_time_control(base_time_ms, increment_ms) -> tuple[int, int]:
    base_ms, inc_ms = int(base_time_ms), int(increment_ms)
    if not MIN_BASE_TIME_MS <= base_ms <= MAX_BASE_TIME_MS or not 0 <= inc_ms <= MAX_INCREMENT_MS:
        raise MatchmakingError("invalid_time_control", "Некорректный контроль времени")
    return base_ms, inc_ms


def _ratings_compatible(rating_a: int, window_a: tuple[int, int], rating_b: int, window_b: tuple[int, int]) -> bool:
    return window_a[0] <= rating_b <= window_a[1] and window_b[0] <= rating_a <= window_b[1]


class Matchmaker:
    """Менеджер открытых вызовов, автоматического паринга и приватных ссылок."""

    @property
    def redis(self):
        from src.db.redis import redis_client
        return redis_client

    @property
    def _state_manager(self):
        from src.services.game_state import state_manager
        return state_manager

    # ------------------------------------------------------------------ вспомогательное

    @asynccontextmanager
    async def _session(self, db: AsyncSession | None):
        if db is not None:
            yield db
        else:
            async with AsyncSessionLocal() as session:
                yield session

    async def _fresh_user(self, session: AsyncSession, user_id: int) -> User | None:
        """Перечитывает пользователя из БД мимо identity map (рейтинг мог измениться)."""
        return await session.get(User, int(user_id), populate_existing=True)

    async def _fresh_rating(self, session: AsyncSession, user_id: int, category: RatingCategory) -> int | None:
        user = await self._fresh_user(session, user_id)
        return user.rating_for(category) if user else None

    async def _ensure_not_in_game(self, user_id: int, *, is_self: bool) -> None:
        if await self._state_manager.get_active_game_id(user_id) is not None:
            if is_self:
                raise MatchmakingError("self_in_game", "Вы уже играете партию")
            raise MatchmakingError("opponent_in_game", "Соперник уже играет другую партию")

    async def _reserve_players(self, *user_ids: int) -> str:
        """Резервирует игроков на время старта партии; при занятости кого-то — откат и ошибка."""
        token = uuid.uuid4().hex
        reserved: list[int] = []
        for uid in sorted({int(u) for u in user_ids}):
            ok = await self.redis.set(f"matchmaking:reserve:{uid}", token, nx=True, px=RESERVATION_TTL_MS)
            if not ok:
                await self._release_players(token, *reserved)
                raise MatchmakingError("players_busy", "Игрок уже начинает другую партию, попробуйте ещё раз")
            reserved.append(uid)
        return token

    async def _release_players(self, token: str, *user_ids: int) -> None:
        for uid in {int(u) for u in user_ids}:
            key = f"matchmaking:reserve:{uid}"
            if await self.redis.get(key) == token:
                await self.redis.delete(key)

    # ------------------------------------------------------------------ лобби

    async def join_queue(
            self,
            user_id: int,
            username: str,
            rating: int,
            base_time_ms: int,
            increment_ms: int,
            min_rating: int | None = None,
            max_rating: int | None = None,
            db: AsyncSession | None = None,
    ):
        """
        Сразу сводит с подходящим вызовом из лобби (ближайшим по рейтингу, с взаимно
        подходящими диапазонами) или публикует собственный вызов. Возвращает game_id или None.
        rating должен быть свежим (вызывающий код перечитывает пользователя из БД).
        """
        uid = int(user_id)
        rating = int(rating)
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)
        window = normalize_rating_window(min_rating, max_rating, rating)
        queue_name = f"queue:{base_ms}:{inc_ms}"

        await self._ensure_not_in_game(uid, is_self=True)

        candidates: list[tuple[int, int]] = []
        for cand_raw in await self.redis.zrange(queue_name, 0, -1):
            cand_id = int(cand_raw)
            if cand_id == uid:
                continue
            prefs = await self.redis.hgetall(f"queue:prefs:{cand_id}")
            if not prefs:
                continue
            cand_rating = int(prefs.get("rating", 0))
            cand_window = (int(prefs.get("min_rating", 0)), int(prefs.get("max_rating", UNBOUNDED_MAX_RATING)))
            if _ratings_compatible(rating, window, cand_rating, cand_window):
                candidates.append((abs(cand_rating - rating), cand_id))

        from src.services.connection_manager import manager
        for _, cand_id in sorted(candidates):
            try:
                matched_game_id = await self.accept_challenge(cand_id, uid, manager, self._state_manager, db=db)
            except MatchmakingError as err:
                if err.code == "self_in_game":
                    raise
                continue  # вызов успели забрать, соперник занят и т.п. — пробуем следующего
            if matched_game_id is not None:
                return matched_game_id

        await self.leave_queue(uid)
        await self.redis.sadd("active_queues", queue_name)
        await self.redis.zadd(queue_name, {str(uid): rating})
        await self.redis.hset(f"queue:prefs:{uid}", mapping={
            "user_id": str(uid),
            "username": str(username),
            "rating": str(rating),
            "min_rating": str(window[0]),
            "max_rating": str(window[1]),
            "base_time_ms": str(base_ms),
            "increment_ms": str(inc_ms),
        })
        logger.info("User %s (%s) published challenge in lobby (%s+%s)", uid, username, base_ms, inc_ms)
        return None

    async def leave_queue(self, user_id: int):
        uid = int(user_id)
        prefs = await self.redis.hgetall(f"queue:prefs:{uid}")
        if prefs:
            queue_name = f"queue:{prefs.get('base_time_ms', 180000)}:{prefs.get('increment_ms', 0)}"
            await self.redis.zrem(queue_name, str(uid))
            await self.redis.delete(f"queue:prefs:{uid}")

        active_queues = await self.redis.smembers("active_queues")
        for qn in active_queues:
            await self.redis.zrem(qn, str(uid))

    async def get_queue_players(self) -> list[dict]:
        """Возвращает список всех активных вызовов в лобби."""
        players = []
        seen: set[int] = set()
        active_queues = await self.redis.smembers("active_queues")
        for queue_name in active_queues:
            user_ids = await self.redis.zrange(queue_name, 0, -1)
            for u_id in user_ids:
                uid = int(u_id)
                if uid in seen:
                    continue
                prefs = await self.redis.hgetall(f"queue:prefs:{uid}")
                if prefs:
                    seen.add(uid)
                    players.append({
                        "user_id": int(prefs.get("user_id", uid)),
                        "username": prefs.get("username", "Игрок"),
                        "rating": int(prefs.get("rating", 1200)),
                        "min_rating": int(prefs.get("min_rating", 0)),
                        "max_rating": int(prefs.get("max_rating", UNBOUNDED_MAX_RATING)),
                        "base_time_ms": int(prefs.get("base_time_ms", 180000)),
                        "increment_ms": int(prefs.get("increment_ms", 0)),
                    })
        return players

    # ------------------------------------------------------------------ старт партии

    async def _create_game_record(
            self,
            session: AsyncSession,
            white_id: int,
            black_id: int,
            base_time: int,
            inc_time: int,
            now_ms: int,
    ) -> dict | None:
        white_user = await self._fresh_user(session, white_id)
        black_user = await self._fresh_user(session, black_id)
        if not white_user or not black_user:
            return None

        category = classify_time_control(base_time, inc_time)
        white_rating = white_user.rating_for(category)
        black_rating = black_user.rating_for(category)

        new_game = Game(
            white_player_id=white_user.id,
            black_player_id=black_user.id,
            base_time_ms=base_time,
            increment_ms=inc_time,
            status=GameStatus.IN_PROGRESS,
            is_rated=True,
            state_version=0,
            turn="w",
            board_fen=chess.STARTING_FEN,
            white_time_ms=base_time,
            black_time_ms=base_time,
            last_move_at=now_ms,
            white_initial_rating=white_rating,
            black_initial_rating=black_rating,
        )
        session.add(new_game)
        await session.commit()
        await session.refresh(new_game)

        return {
            "game_id": new_game.id,
            "white_id": white_user.id,
            "black_id": black_user.id,
            "white_username": white_user.username,
            "white_rating": white_rating,
            "black_username": black_user.username,
            "black_rating": black_rating,
        }

    async def _create_match_record(
            self,
            session: AsyncSession,
            c_id: int,
            a_id: int,
            base_time: int,
            inc_time: int,
            now_ms: int,
    ) -> dict | None:
        """Партия из лобби: цвета случайные."""
        white_id, black_id = (c_id, a_id) if random.random() > 0.5 else (a_id, c_id)
        return await self._create_game_record(session, white_id, black_id, base_time, inc_time, now_ms)

    async def _notify_match_found(self, connection_manager, created: dict, base_time: int, inc_time: int) -> None:
        if connection_manager is None:
            return
        match_payload = {
            "event": "match_found",
            "game_id": created["game_id"],
            "white_username": created["white_username"],
            "white_rating": created["white_rating"],
            "black_username": created["black_username"],
            "black_rating": created["black_rating"],
            "base_time_ms": base_time,
            "increment_ms": inc_time,
            "white_time_ms": base_time,
            "black_time_ms": base_time,
            "fen": chess.STARTING_FEN,
            "pgn": "",
            "state_version": 0,
        }
        await connection_manager.send_personal_message(
            {**match_payload, "color": "white", "opponent_id": created["black_id"]}, created["white_id"],
        )
        await connection_manager.send_personal_message(
            {**match_payload, "color": "black", "opponent_id": created["white_id"]}, created["black_id"],
        )

    async def _start_reserved_game(
            self,
            session: AsyncSession,
            create,
            base_time: int,
            inc_time: int,
            connection_manager,
            players: tuple[int, int],
    ) -> dict | None:
        """Общая часть старта: снять обоих с очереди, создать запись, Redis-состояние, оповестить."""
        from src.services.connection_manager import manager as ws_manager
        for uid in players:
            await self.leave_queue(uid)
            # Игрок мог смотреть чужую партию: иначе её ходы продолжали бы приходить ему
            # во время собственной игры.
            await ws_manager.remove_user_from_all_spectating(uid)

        created = await create(session, int(time.time() * 1000))
        if not created:
            return None

        await self._state_manager.initialize_game(
            game_id=created["game_id"],
            white_id=created["white_id"],
            black_id=created["black_id"],
            base_time_ms=base_time,
            increment_ms=inc_time,
        )
        await self._notify_match_found(connection_manager, created, base_time, inc_time)
        logger.info(
            "Match started: White(%s) vs Black(%s) in game %s",
            created["white_id"], created["black_id"], created["game_id"],
        )
        return {**created, "base_time_ms": base_time, "increment_ms": inc_time, "fen": chess.STARTING_FEN}

    async def start_pvp_game(
            self,
            white_id: int,
            black_id: int,
            base_time_ms: int,
            increment_ms: int,
            connection_manager=None,
            db: AsyncSession | None = None,
            initiator_id: int | None = None,
    ) -> dict:
        """
        Стартует рейтинговую партию с заданными цветами (приглашение, реванш).
        initiator_id — кто инициировал старт (для текста ошибки «вы уже играете»).
        """
        white_id, black_id = int(white_id), int(black_id)
        if white_id == black_id:
            raise MatchmakingError("invalid", "Нельзя играть с самим собой")
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)

        token = await self._reserve_players(white_id, black_id)
        try:
            for uid in (white_id, black_id):
                is_self = initiator_id is None or uid == int(initiator_id)
                await self._ensure_not_in_game(uid, is_self=is_self)

            async with self._session(db) as session:
                started = await self._start_reserved_game(
                    session,
                    lambda s, now_ms: self._create_game_record(s, white_id, black_id, base_ms, inc_ms, now_ms),
                    base_ms, inc_ms, connection_manager, (white_id, black_id),
                )
            if not started:
                raise MatchmakingError("invalid", "Игрок не найден")
            return started
        finally:
            await self._release_players(token, white_id, black_id)

    async def accept_challenge(
            self,
            challenger_id: int,
            acceptor_id: int,
            connection_manager,
            state_manager=None,
            db: AsyncSession | None = None,
    ):
        """
        Атомарное принятие вызова из лобби: проверки занятости и диапазона рейтинга, захват
        вызова, создание партии и оповещение обоих игроков. Возвращает game_id или бросает
        MatchmakingError.
        """
        c_id = int(challenger_id)
        a_id = int(acceptor_id)
        if c_id == a_id:
            raise MatchmakingError("invalid", "Нельзя принять собственный вызов")

        token = await self._reserve_players(c_id, a_id)
        try:
            await self._ensure_not_in_game(a_id, is_self=True)

            prefs_key = f"queue:prefs:{c_id}"
            prefs = await self.redis.hgetall(prefs_key)
            if not prefs:
                raise MatchmakingError("challenge_gone", "Вызов уже неактивен или принят другим игроком")

            if await self._state_manager.get_active_game_id(c_id) is not None:
                await self.leave_queue(c_id)  # вызов игрока, который уже играет, устарел
                raise MatchmakingError("opponent_in_game", "Соперник уже играет другую партию")

            base_time = int(prefs.get("base_time_ms", 180000))
            inc_time = int(prefs.get("increment_ms", 0))
            category = classify_time_control(base_time, inc_time)

            async with self._session(db) as session:
                acceptor_rating = await self._fresh_rating(session, a_id, category)
                if acceptor_rating is None:
                    raise MatchmakingError("invalid", "Игрок не найден")
                lo = int(prefs.get("min_rating", 0))
                hi = int(prefs.get("max_rating", UNBOUNDED_MAX_RATING))
                if not lo <= acceptor_rating <= hi:
                    raise MatchmakingError(
                        "rating_out_of_range",
                        f"Ваш рейтинг {acceptor_rating} вне диапазона вызова ({lo}–{hi})",
                    )

                # Захват вызова: удалить ключ сможет только один из конкурирующих принимающих.
                if not await self.redis.delete(prefs_key):
                    raise MatchmakingError("challenge_gone", "Вызов уже неактивен или принят другим игроком")

                started = await self._start_reserved_game(
                    session,
                    lambda s, now_ms: self._create_match_record(s, c_id, a_id, base_time, inc_time, now_ms),
                    base_time, inc_time, connection_manager, (c_id, a_id),
                )
            if not started:
                raise MatchmakingError("invalid", "Игрок не найден")
            return started["game_id"]
        finally:
            await self._release_players(token, c_id, a_id)

    # ------------------------------------------------------------------ приглашения

    async def create_private_invite(
            self,
            user_id: int,
            username: str = "Игрок",
            rating: int = 1200,
            base_time_ms: int = 180000,
            increment_ms: int = 2000,
            color_pref: str = "random",
    ) -> dict:
        await self._ensure_not_in_game(user_id, is_self=True)
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)

        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
        if color_pref not in ("white", "black", "random"):
            color_pref = "random"

        payload = {
            "code": code,
            "creator_id": int(user_id),
            "creator_username": username,
            "creator_rating": int(rating),
            "base_time_ms": base_ms,
            "increment_ms": inc_ms,
            "color_pref": color_pref,
        }
        await self.redis.set(f"invite:{code}", json.dumps(payload), ex=INVITE_TTL_S)
        return payload

    async def get_private_invite(self, code: str) -> dict | None:
        raw = await self.redis.get(f"invite:{code}")
        if not raw:
            return None
        return json.loads(raw)

    async def accept_private_invite(self, code: str, acceptor_id: int) -> dict | None:
        """Атомарно погашает приглашение и распределяет цвета (без старта партии)."""
        key = f"invite:{code}"

        raw = await self.redis.get(key)
        if not raw:
            return None

        invite = json.loads(raw)
        creator_id = int(invite["creator_id"])
        if creator_id == int(acceptor_id):
            return None

        if not await self.redis.delete(key):
            return None  # приглашение уже принял кто-то другой

        color_pref = invite.get("color_pref", "random")
        if color_pref == "white":
            white_id, black_id = creator_id, int(acceptor_id)
        elif color_pref == "black":
            white_id, black_id = int(acceptor_id), creator_id
        else:
            if random.random() < 0.5:
                white_id, black_id = creator_id, int(acceptor_id)
            else:
                white_id, black_id = int(acceptor_id), creator_id

        return {
            "code": code,
            "creator_id": creator_id,
            "acceptor_id": int(acceptor_id),
            "white_id": white_id,
            "black_id": black_id,
            "base_time_ms": int(invite.get("base_time_ms", 180000)),
            "increment_ms": int(invite.get("increment_ms", 0)),
            "_raw": raw,
        }

    async def start_game_from_invite(
            self,
            code: str,
            acceptor_id: int,
            connection_manager=None,
            db: AsyncSession | None = None,
    ) -> dict:
        """
        Принимает приглашение и стартует партию. Если старт не удался (кто-то из игроков уже
        в партии), приглашение возвращается в Redis, чтобы им можно было воспользоваться позже.
        """
        await self._ensure_not_in_game(acceptor_id, is_self=True)

        accepted = await self.accept_private_invite(code, acceptor_id)
        if not accepted:
            raise MatchmakingError("invite_invalid", "Приглашение недействительно или истекло")

        try:
            return await self.start_pvp_game(
                accepted["white_id"], accepted["black_id"],
                accepted["base_time_ms"], accepted["increment_ms"],
                connection_manager=connection_manager, db=db, initiator_id=acceptor_id,
            )
        except MatchmakingError:
            await self.redis.set(f"invite:{code}", accepted["_raw"], ex=INVITE_TTL_S)
            raise


matchmaker = Matchmaker()
