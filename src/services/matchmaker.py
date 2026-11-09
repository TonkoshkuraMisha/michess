# --- FILE: src/services/matchmaker.py ---

import asyncio
import json
import logging
import random
import secrets
import time
import chess
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import AsyncSessionLocal
from src.models.game import Game, GameStatus
from src.models.user import User

logger = logging.getLogger(__name__)

_INVITE_REDEEM_LOCK = asyncio.Lock()
_CHALLENGE_ACCEPT_LOCK = asyncio.Lock()


class Matchmaker:
    """Менеджер открытых вызовов, автоматического паринга и приватных ссылок."""

    @property
    def redis(self):
        from src.db.redis import redis_client
        return redis_client

    async def join_queue(
            self,
            user_id: int,
            username: str,
            rating: int,
            base_time_ms: int,
            increment_ms: int,
            min_rating: int,
            max_rating: int,
            db: AsyncSession | None = None,
    ):
        uid = int(user_id)
        base_ms = int(base_time_ms)
        inc_ms = int(increment_ms)
        queue_name = f"queue:{base_ms}:{inc_ms}"

        existing_ids = await self.redis.zrange(queue_name, 0, -1)
        for cand_raw in existing_ids:
            cand_id = int(cand_raw)
            if cand_id != uid:
                from src.services.connection_manager import manager
                from src.services.game_state import state_manager
                matched_game_id = await self.accept_challenge(
                    cand_id, uid, manager, state_manager, db=db
                )
                if matched_game_id is not None:
                    return matched_game_id

        await self.leave_queue(uid)
        await self.redis.sadd("active_queues", queue_name)
        await self.redis.zadd(queue_name, {str(uid): int(rating)})

        prefs = {
            "user_id": str(uid),
            "username": str(username),
            "rating": str(rating),
            "min_rating": str(min_rating),
            "max_rating": str(max_rating),
            "base_time_ms": str(base_ms),
            "increment_ms": str(inc_ms),
        }
        await self.redis.hset(f"queue:prefs:{uid}", mapping=prefs)
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
                        "base_time_ms": int(prefs.get("base_time_ms", 180000)),
                        "increment_ms": int(prefs.get("increment_ms", 0)),
                    })
        return players

    async def _create_match_record(
            self,
            session: AsyncSession,
            c_id: int,
            a_id: int,
            base_time: int,
            inc_time: int,
            now_ms: int,
    ) -> dict | None:
        u1_user = await session.get(User, c_id)
        u2_user = await session.get(User, a_id)

        if not u1_user or not u2_user:
            return None

        white_id, black_id = (u1_user.id, u2_user.id) if random.random() > 0.5 else (u2_user.id, u1_user.id)
        white_user = u1_user if white_id == u1_user.id else u2_user
        black_user = u1_user if black_id == u1_user.id else u2_user

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
            white_initial_rating=white_user.rating,
            black_initial_rating=black_user.rating,
        )
        session.add(new_game)
        await session.commit()
        await session.refresh(new_game)

        return {
            "game_id": new_game.id,
            "white_id": white_id,
            "black_id": black_id,
            "white_username": white_user.username,
            "white_rating": white_user.rating,
            "black_username": black_user.username,
            "black_rating": black_user.rating,
        }

    async def accept_challenge(
            self,
            challenger_id: int,
            acceptor_id: int,
            connection_manager,
            state_manager,
            db: AsyncSession | None = None,
    ):
        """Атомарное принятие вызова из лобби с созданием партии в БД/Redis и оповещением обоих игроков."""
        c_id = int(challenger_id)
        a_id = int(acceptor_id)
        if c_id == a_id:
            return None

        async with _CHALLENGE_ACCEPT_LOCK:
            p1_prefs = await self.redis.hgetall(f"queue:prefs:{c_id}")
            if not p1_prefs:
                logger.warning("Challenge from %s no longer active", c_id)
                return None

            base_time = int(p1_prefs.get("base_time_ms", 180000))
            inc_time = int(p1_prefs.get("increment_ms", 0))

            await self.leave_queue(c_id)
            await self.leave_queue(a_id)

        now_ms = int(time.time() * 1000)

        if db is not None:
            created = await self._create_match_record(db, c_id, a_id, base_time, inc_time, now_ms)
        else:
            async with AsyncSessionLocal() as session:
                created = await self._create_match_record(session, c_id, a_id, base_time, inc_time, now_ms)

        if not created:
            return None

        game_id = created["game_id"]
        white_id = created["white_id"]
        black_id = created["black_id"]

        await state_manager.initialize_game(
            game_id=game_id,
            white_id=white_id,
            black_id=black_id,
            base_time_ms=base_time,
            increment_ms=inc_time,
        )

        match_payload = {
            "event": "match_found",
            "game_id": game_id,
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

        w_payload = {**match_payload, "color": "white", "opponent_id": black_id}
        b_payload = {**match_payload, "color": "black", "opponent_id": white_id}

        await connection_manager.send_personal_message(w_payload, white_id)
        await connection_manager.send_personal_message(b_payload, black_id)

        logger.info("Match started: White(%s) vs Black(%s) in game %s", white_id, black_id, game_id)
        return game_id

    async def create_private_invite(
            self,
            user_id: int,
            username: str = "Игрок",
            rating: int = 1200,
            base_time_ms: int = 180000,
            increment_ms: int = 2000,
            color_pref: str = "random",
    ) -> dict:
        from src.services.game_state import state_manager

        redis_conn = getattr(self, "redis", None) or state_manager.redis
        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
        if color_pref not in ("white", "black", "random"):
            color_pref = "random"

        payload = {
            "code": code,
            "creator_id": int(user_id),
            "creator_username": username,
            "creator_rating": int(rating),
            "base_time_ms": int(base_time_ms),
            "increment_ms": int(increment_ms),
            "color_pref": color_pref,
        }
        try:
            await redis_conn.set(f"invite:{code}", json.dumps(payload), ex=900)
        except TypeError:
            await redis_conn.set(f"invite:{code}", json.dumps(payload))
        return payload

    async def get_private_invite(self, code: str) -> dict | None:
        from src.services.game_state import state_manager

        redis_conn = getattr(self, "redis", None) or state_manager.redis
        raw = await redis_conn.get(f"invite:{code}")
        if not raw:
            return None
        return json.loads(raw)

    async def accept_private_invite(self, code: str, acceptor_id: int) -> dict | None:
        from src.services.game_state import state_manager

        redis_conn = getattr(self, "redis", None) or state_manager.redis
        key = f"invite:{code}"

        async with _INVITE_REDEEM_LOCK:
            raw = await redis_conn.get(key)
            if not raw:
                return None

            invite = json.loads(raw)
            creator_id = int(invite["creator_id"])
            if creator_id == int(acceptor_id):
                return None

            deleted = await redis_conn.delete(key)
            if not deleted:
                return None

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
        }


matchmaker = Matchmaker()
