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

Где лежат данные. Redis:
- ``queue:{base_ms}:{inc_ms}`` и ``queue:{base_ms}:{inc_ms}:casual`` — очереди вызовов одного контроля времени
  (ZSET: игрок → рейтинг в момент публикации); рейтинговые и товарищеские — раздельно;
- ``queue:prefs:{user_id}`` — параметры вызова игрока (HASH); у игрока не больше одного вызова;
- ``active_queues`` — имена очередей, в которых когда-либо были вызовы (SET): по нему собирается список лобби;
- ``matchmaking:reserve:{user_id}`` — резерв игрока на время старта партии (живёт RESERVATION_TTL_MS);
- ``invite:{code}`` — приглашение по ссылке (JSON, живёт INVITE_TTL_S).
PostgreSQL: запись партии создаётся в ``games``; рейтинги игроков читаются из ``users`` по категории контроля
времени (src/services/rating.classify_time_control). Состояние идущей партии в Redis создаёт
src/services/game_state.py (``initialize_game``). Действия игроков приходят из src/api/websockets.py.
"""

import json
import logging
import random
import secrets
import string
import time
import uuid
from contextlib import asynccontextmanager

import chess
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.errors import DomainError
from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import RatingCategory, User
from src.services.game_engine import game_variant
from src.services.odds import pgn_header
from src.services.rating import classify_time_control

logger = logging.getLogger(__name__)

# Резерв игрока на время старта партии: снимается сразу после старта; срок нужен, чтобы упавший процесс не
# заблокировал игрока дольше 15 секунд.
RESERVATION_TTL_MS = 15_000
INVITE_TTL_S = 900  # приглашение по ссылке действует 15 минут
UNBOUNDED_MAX_RATING = 10_000  # верхняя граница диапазона «без ограничения» (выше любого рейтинга)

# Допустимый контроль времени партии между людьми: от 15 секунд до 3 часов на партию, добавка — до 3 минут за ход.
MIN_BASE_TIME_MS = 15_000
MAX_BASE_TIME_MS = 3 * 60 * 60 * 1000
MAX_INCREMENT_MS = 180_000


# Код приглашения по ссылке: длина и алфавит (буквы и цифры, без похожих на «-» и «_» символов).
INVITE_CODE_LENGTH = 8
INVITE_CODE_ALPHABET = string.ascii_letters + string.digits


class MatchmakingError(DomainError):
    """Ожидаемый отказ матчмейкинга: код из реестра src/core/errors.py и его параметры."""


def default_rating_window(rating: int) -> tuple[int, int]:
    """
    Диапазон по умолчанию, если клиент не прислал свой: рейтинг ± MATCHMAKING_DEFAULT_RATING_RANGE (настройка
    src/core/config.py; 0, как по умолчанию, — без ограничения).
    """
    spread = int(settings.MATCHMAKING_DEFAULT_RATING_RANGE)
    if spread <= 0:
        return 0, UNBOUNDED_MAX_RATING
    return max(0, rating - spread), rating + spread


def normalize_rating_window(min_rating, max_rating, rating: int) -> tuple[int, int]:
    """
    Диапазон рейтинга соперника для вызова: границы клиента, недостающая — из диапазона по умолчанию; отрицательные
    значения поднимаются до 0, перепутанные границы меняются местами.
    """
    default_min, default_max = default_rating_window(rating)
    lo = default_min if min_rating is None else max(0, int(min_rating))
    hi = default_max if max_rating is None else max(0, int(max_rating))
    return (lo, hi) if lo <= hi else (hi, lo)


def validate_time_control(base_time_ms, increment_ms) -> tuple[int, int]:
    """Контроль времени в миллисекундах; вне пределов MIN_BASE_TIME_MS…MAX_INCREMENT_MS — отказ invalid_time_control."""
    base_ms, inc_ms = int(base_time_ms), int(increment_ms)
    if not MIN_BASE_TIME_MS <= base_ms <= MAX_BASE_TIME_MS or not 0 <= inc_ms <= MAX_INCREMENT_MS:
        raise MatchmakingError("invalid_time_control")
    return base_ms, inc_ms


def _queue_name(base_ms, inc_ms, rated: bool) -> str:
    """Рейтинговые и товарищеские вызовы лежат в разных очередях и между собой не сводятся."""
    return f"queue:{base_ms}:{inc_ms}" if rated else f"queue:{base_ms}:{inc_ms}:casual"


def _prefs_rated(prefs: dict) -> bool:
    """Рейтинговый ли вызов по его параметрам из Redis; вызов без поля ``rated`` считается рейтинговым."""
    return str(prefs.get("rated", "1")) != "0"


def _ratings_compatible(rating_a: int, window_a: tuple[int, int], rating_b: int, window_b: tuple[int, int]) -> bool:
    """Взаимное соответствие: рейтинг каждого игрока попадает в диапазон другого (границы включительно)."""
    return window_a[0] <= rating_b <= window_a[1] and window_b[0] <= rating_a <= window_b[1]



VARIANTS = ("standard", "chess960")  # варианты партии по приглашению; неизвестное значение заменяется на standard


def chess960_start(number: int | None = None) -> str:
    """Начальная позиция партии Фишера (21.3) в Shredder-FEN: случайная из 960 или по номеру."""
    from src.services.game_engine import fen_of

    board = chess.Board.from_chess960_pos(random.randrange(960) if number is None else number)
    return fen_of(board)


def _odds_start(invite: dict, creator_id: int, white_id: int) -> dict | None:
    """
    Начальная позиция и время партии с форой или партии Фишера из приглашения — когда цвета уже распределены.
    Партия 960 — без форы и без рейтинга; расстановку выбирает сервер в момент старта (одна на обоих игроков).
    «Песочные часы» — обычные позиция и время, флаг hourglass меняет ход часов (src/services/game_state.py).
    """
    from src.services.odds import HOURGLASS, odds_fen, odds_times

    if invite.get("variant") == "chess960":
        base_ms = int(invite.get("base_time_ms", 180000))
        return {"start_fen": chess960_start(), "white_time_ms": base_ms, "black_time_ms": base_ms, "kind": "chess960"}
    kind = invite.get("odds_kind") or ""
    if not kind:
        return None
    creator_white = creator_id == white_id
    giver_white = creator_white if invite.get("odds_giver", "creator") == "creator" else not creator_white
    giver = chess.WHITE if giver_white else chess.BLACK
    white_ms, black_ms = odds_times(kind, giver, int(invite.get("base_time_ms", 180000)))
    return {"start_fen": odds_fen(kind, giver), "white_time_ms": white_ms, "black_time_ms": black_ms, "kind": kind,
            "hourglass": kind == HOURGLASS}


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
        """Сессия вызывающего кода, а если её не передали — своя короткая, закрываемая на выходе."""
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
        """
        Отказ, если у игрока есть идущая партия (ключ user:{id}:current_game, game_state.py): self_in_game — когда
        это сам запросивший, opponent_in_game — когда его соперник.
        """
        if await self._state_manager.get_active_game_id(user_id) is not None:
            if is_self:
                raise MatchmakingError("self_in_game")
            raise MatchmakingError("opponent_in_game")

    async def _reserve_players(self, *user_ids: int) -> str:
        """
        Резервирует игроков на время старта партии (SET NX с общим токеном); при занятости кого-то — откат уже
        взятых резервов и отказ players_busy. Возвращает токен для ``_release_players``.
        """
        token = uuid.uuid4().hex
        reserved: list[int] = []
        for uid in sorted({int(u) for u in user_ids}):
            ok = await self.redis.set(f"matchmaking:reserve:{uid}", token, nx=True, px=RESERVATION_TTL_MS)
            if not ok:
                await self._release_players(token, *reserved)
                raise MatchmakingError("players_busy")
            reserved.append(uid)
        return token

    async def _release_players(self, token: str, *user_ids: int) -> None:
        """Снимает резерв, но только свой (по токену): истёкший и уже взятый другим стартом резерв не трогается."""
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
            rated: bool = True,
    ):
        """
        Сразу сводит с подходящим вызовом из лобби (ближайшим по рейтингу, с взаимно
        подходящими диапазонами) или публикует собственный вызов. Возвращает game_id или None.
        rating должен быть свежим (вызывающий код перечитывает пользователя из БД).

        Кандидаты берутся только из очереди того же контроля времени и того же типа (рейтинговая / товарищеская).
        Рейтинг кандидата — тот, с которым он опубликовал вызов. Публикация нового вызова снимает прежний вызов
        игрока: у игрока в лобби не больше одного вызова.
        """
        uid = int(user_id)
        rating = int(rating)
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)
        window = normalize_rating_window(min_rating, max_rating, rating)
        queue_name = _queue_name(base_ms, inc_ms, rated)

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
            "rated": "1" if rated else "0",
        })
        logger.info(
            "User %s (%s) published %s challenge in lobby (%s+%s)",
            uid, username, "rated" if rated else "casual", base_ms, inc_ms,
        )
        return None

    async def leave_queue(self, user_id: int):
        """
        Снимает вызов игрока из лобби: из очереди его контроля времени, из настроек вызова и — на случай
        рассогласования — из всех активных очередей.
        """
        uid = int(user_id)
        prefs = await self.redis.hgetall(f"queue:prefs:{uid}")
        if prefs:
            queue_name = _queue_name(
                prefs.get("base_time_ms", 180000), prefs.get("increment_ms", 0), _prefs_rated(prefs),
            )
            await self.redis.zrem(queue_name, str(uid))
            await self.redis.delete(f"queue:prefs:{uid}")

        active_queues = await self.redis.smembers("active_queues")
        for qn in active_queues:
            await self.redis.zrem(qn, str(uid))

    async def get_queue_players(self) -> list[dict]:
        """
        Возвращает список всех активных вызовов в лобби (по одному на игрока): обходит очереди из ``active_queues``
        и читает параметры вызова из ``queue:prefs:{user_id}``; запись очереди без параметров пропускается.
        """
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
                        "username": prefs.get("username", ""),
                        "rating": int(prefs.get("rating", 1200)),
                        "min_rating": int(prefs.get("min_rating", 0)),
                        "max_rating": int(prefs.get("max_rating", UNBOUNDED_MAX_RATING)),
                        "base_time_ms": int(prefs.get("base_time_ms", 180000)),
                        "increment_ms": int(prefs.get("increment_ms", 0)),
                        "rated": _prefs_rated(prefs),
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
            is_rated: bool = True,
            odds: dict | None = None,
    ) -> dict | None:
        """
        Создаёт запись партии в ``games`` (статус IN_PROGRESS) и возвращает данные для состояния в Redis и события
        match_found; None — кого-то из игроков нет в базе. Рейтинги на начало партии (``white_initial_rating``,
        ``black_initial_rating``) берутся свежими из ``users`` по категории контроля времени. Категория считается
        по base_time и inc_time партии, а не по времени, урезанному форой. odds (``_odds_start``) задаёт начальную
        позицию, стартовое время сторон и «песочные часы» (флаг hourglass).
        """
        white_user = await self._fresh_user(session, white_id)
        black_user = await self._fresh_user(session, black_id)
        if not white_user or not black_user:
            return None
        odds = odds or {}
        start_fen = odds.get("start_fen")
        white_ms, black_ms = odds.get("white_time_ms", base_time), odds.get("black_time_ms", base_time)

        category = classify_time_control(base_time, inc_time)
        white_rating = white_user.rating_for(category)
        black_rating = black_user.rating_for(category)

        new_game = Game(
            white_player_id=white_user.id,
            black_player_id=black_user.id,
            base_time_ms=base_time,
            increment_ms=inc_time,
            status=GameStatus.IN_PROGRESS,
            is_rated=is_rated,
            state_version=0,
            turn="w",
            board_fen=start_fen or chess.STARTING_FEN,
            initial_fen=start_fen,
            hourglass=bool(odds.get("hourglass")),
            white_time_ms=white_ms,
            black_time_ms=black_ms,
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
            "is_rated": is_rated,
            "start_fen": start_fen,
            "white_time_ms": white_ms,
            "black_time_ms": black_ms,
            "hourglass": bool(odds.get("hourglass")),
        }

    async def _create_match_record(
            self,
            session: AsyncSession,
            c_id: int,
            a_id: int,
            base_time: int,
            inc_time: int,
            now_ms: int,
            is_rated: bool = True,
    ) -> dict | None:
        """Партия из лобби: цвета случайные."""
        white_id, black_id = (c_id, a_id) if random.random() > 0.5 else (a_id, c_id)
        return await self._create_game_record(session, white_id, black_id, base_time, inc_time, now_ms, is_rated)

    async def _notify_match_found(self, connection_manager, created: dict, base_time: int, inc_time: int,
                                  arena: dict | None = None) -> None:
        """
        Событие match_found обоим игрокам: одинаковые данные партии плюс свой цвет и номер соперника. Без
        connection_manager (параметр необязателен, так вызывают тесты) ничего не отправляется.
        """
        if connection_manager is None:
            return
        match_payload = {
            "event": "match_found",
            "game_id": created["game_id"],
            "white_username": created["white_username"],
            "white_rating": created["white_rating"],
            "black_username": created["black_username"],
            "black_rating": created["black_rating"],
            "is_rated": created.get("is_rated", True),
            "base_time_ms": base_time,
            "increment_ms": inc_time,
            "white_time_ms": created.get("white_time_ms", base_time),
            "black_time_ms": created.get("black_time_ms", base_time),
            "fen": created.get("start_fen") or chess.STARTING_FEN,
            "pgn": pgn_header(created["start_fen"]) if created.get("start_fen") else "",
            # Партия Фишера (21.3) идёт на отдельной странице клиента: по этому полю он туда переходит.
            "variant": game_variant(created.get("start_fen")),
            # «Песочные часы» (21.1): по этому полю клиент ведёт часы так же, как сервер.
            "hourglass": bool(created.get("hourglass")),
            "state_version": 0,
        }
        if arena:
            # Партия арены (33.3): по этим полям клиент показывает «берсерк» до первого хода.
            match_payload["arena_id"] = arena["arena_id"]
            match_payload["berserk_allowed"] = bool(arena.get("berserk_allowed"))
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
            arena: dict | None = None,
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
            is_rated=created.get("is_rated", True),
            start_fen=created.get("start_fen"),
            white_time_ms=created.get("white_time_ms"),
            black_time_ms=created.get("black_time_ms"),
            arena=arena,
            hourglass=bool(created.get("hourglass")),
        )
        await self._notify_match_found(connection_manager, created, base_time, inc_time, arena)
        logger.info(
            "Match started: White(%s) vs Black(%s) in game %s",
            created["white_id"], created["black_id"], created["game_id"],
        )
        return {**created, "base_time_ms": base_time, "increment_ms": inc_time,
                "fen": created.get("start_fen") or chess.STARTING_FEN}

    async def start_pvp_game(
            self,
            white_id: int,
            black_id: int,
            base_time_ms: int,
            increment_ms: int,
            connection_manager=None,
            db: AsyncSession | None = None,
            initiator_id: int | None = None,
            is_rated: bool = True,
            odds: dict | None = None,
            arena: dict | None = None,
    ) -> dict:
        """
        Стартует партию с заданными цветами (приглашение, реванш, пара арены). odds — начальная позиция и время
        партии с форой или партии Фишера (``_odds_start``); такая партия всегда без рейтинга, что бы ни было
        передано в is_rated. arena — пометка партии арены (``arena._game_marker``): номер арены и доступен ли
        берсерк. initiator_id — кто инициировал старт: от него зависит код отказа, если кто-то уже играет
        (self_in_game — про самого инициатора, opponent_in_game — про его соперника; без initiator_id оба игрока
        считаются инициаторами). Оба игрока на время старта резервируются; резерв снимается в любом случае.
        """
        white_id, black_id = int(white_id), int(black_id)
        if white_id == black_id:
            raise MatchmakingError("self_play")
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)

        token = await self._reserve_players(white_id, black_id)
        try:
            for uid in (white_id, black_id):
                is_self = initiator_id is None or uid == int(initiator_id)
                await self._ensure_not_in_game(uid, is_self=is_self)

            async with self._session(db) as session:
                started = await self._start_reserved_game(
                    session,
                    lambda s, now_ms: self._create_game_record(
                        s, white_id, black_id, base_ms, inc_ms, now_ms, is_rated and not odds, odds=odds,
                    ),
                    base_ms, inc_ms, connection_manager, (white_id, black_id), arena=arena,
                )
            if not started:
                raise MatchmakingError("player_not_found")
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

        Диапазон вызова сверяется со свежим рейтингом принимающего из базы — в категории контроля времени вызова.
        Вызов игрока, который уже играет другую партию, считается устаревшим и снимается из лобби. Цвета — случайные.
        """
        c_id = int(challenger_id)
        a_id = int(acceptor_id)
        if c_id == a_id:
            raise MatchmakingError("own_challenge")

        token = await self._reserve_players(c_id, a_id)
        try:
            await self._ensure_not_in_game(a_id, is_self=True)

            prefs_key = f"queue:prefs:{c_id}"
            prefs = await self.redis.hgetall(prefs_key)
            if not prefs:
                raise MatchmakingError("challenge_gone")

            if await self._state_manager.get_active_game_id(c_id) is not None:
                await self.leave_queue(c_id)  # вызов игрока, который уже играет, устарел
                raise MatchmakingError("opponent_in_game")

            base_time = int(prefs.get("base_time_ms", 180000))
            inc_time = int(prefs.get("increment_ms", 0))
            is_rated = _prefs_rated(prefs)
            category = classify_time_control(base_time, inc_time)

            async with self._session(db) as session:
                acceptor_rating = await self._fresh_rating(session, a_id, category)
                if acceptor_rating is None:
                    raise MatchmakingError("player_not_found")
                lo = int(prefs.get("min_rating", 0))
                hi = int(prefs.get("max_rating", UNBOUNDED_MAX_RATING))
                if not lo <= acceptor_rating <= hi:
                    raise MatchmakingError("rating_out_of_range", rating=acceptor_rating, min=lo, max=hi)

                # Захват вызова: удалить ключ сможет только один из конкурирующих принимающих.
                if not await self.redis.delete(prefs_key):
                    raise MatchmakingError("challenge_gone")

                started = await self._start_reserved_game(
                    session,
                    lambda s, now_ms: self._create_match_record(
                        s, c_id, a_id, base_time, inc_time, now_ms, is_rated,
                    ),
                    base_time, inc_time, connection_manager, (c_id, a_id),
                )
            if not started:
                raise MatchmakingError("player_not_found")
            return started["game_id"]
        finally:
            await self._release_players(token, c_id, a_id)

    # ------------------------------------------------------------------ приглашения

    async def create_private_invite(
            self,
            user_id: int,
            username: str = "",
            rating: int = 1200,
            base_time_ms: int = 180000,
            increment_ms: int = 2000,
            color_pref: str = "random",
            rated: bool = True,
            odds_kind: str = "",
            odds_giver: str = "creator",
            variant: str = "standard",
    ) -> dict:
        """
        Приглашение по ссылке: код с параметрами партии (контроль времени, цвет, тип, фора, вариант) хранится в Redis
        (``invite:{code}``) до принятия или истечения срока INVITE_TTL_S. Неизвестные значения цвета, форы и варианта
        заменяются значениями по умолчанию, а не отклоняются. Код — до 8 букв и цифр. Прежние приглашения игрока
        этот метод не отзывает: каждое живёт до своего срока.
        """
        from src.services.odds import GIVERS, KINDS

        await self._ensure_not_in_game(user_id, is_self=True)
        base_ms, inc_ms = validate_time_control(base_time_ms, increment_ms)
        if odds_kind not in KINDS:
            odds_kind = ""
        if odds_giver not in GIVERS:
            odds_giver = "creator"
        if variant not in VARIANTS:
            variant = "standard"
        if variant == "chess960":
            odds_kind = ""  # фора и 960 вместе не бывают

        # Ровно INVITE_CODE_LENGTH букв и цифр: прежний token_urlsafe с вырезанными «-» и «_» иногда давал код короче шести.
        code = "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH))
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
            # Партия с форой или партия Фишера рейтинга не меняет (как с ботом).
            "rated": bool(rated) and not odds_kind and variant == "standard",
            "odds_kind": odds_kind,
            "odds_giver": odds_giver,
            "variant": variant,
        }
        await self.redis.set(f"invite:{code}", json.dumps(payload), ex=INVITE_TTL_S)
        return payload

    async def get_private_invite(self, code: str) -> dict | None:
        """Параметры приглашения по коду, не погашая его; None — кода нет или срок истёк."""
        raw = await self.redis.get(f"invite:{code}")
        if not raw:
            return None
        return json.loads(raw)

    async def accept_private_invite(self, code: str, acceptor_id: int) -> dict | None:
        """
        Атомарно погашает приглашение и распределяет цвета (без старта партии). None — приглашения нет, срок истёк,
        принимает сам автор или его успел принять другой. Цвет автора — по его выбору, «random» — жребий. В ответе
        ``_raw`` — исходная запись, чтобы вернуть приглашение в Redis, если старт партии не удастся.
        """
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
            "rated": bool(invite.get("rated", True)),
            "odds": _odds_start(invite, creator_id, white_id),
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
        Принимает приглашение и стартует партию. Если старт не удался (например, кто-то из игроков уже
        в партии или занят стартом другой), приглашение возвращается в Redis, чтобы им можно было
        воспользоваться позже, — с новым полным сроком INVITE_TTL_S.
        """
        await self._ensure_not_in_game(acceptor_id, is_self=True)

        accepted = await self.accept_private_invite(code, acceptor_id)
        if not accepted:
            raise MatchmakingError("invite_invalid")

        try:
            return await self.start_pvp_game(
                accepted["white_id"], accepted["black_id"],
                accepted["base_time_ms"], accepted["increment_ms"],
                connection_manager=connection_manager, db=db, initiator_id=acceptor_id,
                is_rated=accepted["rated"], odds=accepted["odds"],
            )
        except MatchmakingError:
            await self.redis.set(f"invite:{code}", accepted["_raw"], ex=INVITE_TTL_S)
            raise


matchmaker = Matchmaker()
