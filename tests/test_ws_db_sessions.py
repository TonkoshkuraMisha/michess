# --- FILE: tests/test_ws_db_sessions.py ---
"""
WebSocket не должен держать соединение пула БД, пока игрок просто подключён.

Раньше обработчик брал одну сессию на всё соединение: первый запрос (проверка токена) открывал
транзакцию, и соединение пула оставалось занятым до отключения игрока. При пуле на N соединений
(N+1)-й подключившийся игрок ждал pool_timeout и получал ошибку.
"""

import asyncio
import json

import pytest
from fastapi import WebSocketDisconnect
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool

from src.api.deps import get_current_user_ws
from src.api.websockets import matchmaking_endpoint
from src.db import redis as redis_module
from src.models.base import Base
from src.models.user import User
from src.services.game_state import state_manager

_CLOSE = object()


class QueueSocket:
    """WebSocket-заглушка: входящие сообщения — из очереди, исходящие складываются в список."""

    def __init__(self):
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))

    async def receive_text(self):
        item = await self.incoming.get()
        if item is _CLOSE:
            raise WebSocketDisconnect(code=1000)
        return json.dumps(item)

    async def wait_for(self, event: str, wait_s: float = 5.0) -> dict:
        async def _poll():
            while True:
                for message in self.sent:
                    if message.get("event") == event:
                        return message
                await asyncio.sleep(0.01)
        return await asyncio.wait_for(_poll(), wait_s)


async def _make_users(url: str, count: int) -> list[tuple[int, str]]:
    setup_engine = create_async_engine(url, poolclass=NullPool)
    async with setup_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(setup_engine, expire_on_commit=False)() as db:
        names = [f"pool_user_{i}" for i in range(count)]
        users = [User(
            username=name, hashed_password="pw", bullet_rating=1500,
            blitz_rating=1500, rapid_rating=1500, classical_rating=1500
        ) for name in names]
        db.add_all(users)
        await db.commit()
        created = [(u.id, u.username) for u in users]
    await setup_engine.dispose()
    return created


async def _issue_ticket(user_id: int) -> str:
    """Как POST /auth/ws-ticket: одноразовый тикет в Redis (token_version новых пользователей — 0)."""
    ticket = f"ticket-{user_id}"
    await redis_module.redis_client.set(f"ws_ticket:{ticket}", f"{user_id}:0", ex=30)
    return ticket


async def test_connected_players_do_not_hold_pool_connections(tmp_path):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'pool.db').as_posix()}"
    created = await _make_users(url, 3)
    names = [name for _, name in created]

    # Пул на одно соединение: при старой схеме второй подключившийся уже не прошёл бы аутентификацию.
    engine = create_async_engine(
        url, poolclass=AsyncAdaptedQueuePool, pool_size=1, max_overflow=0, pool_timeout=1,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    sockets: list[QueueSocket] = []
    tasks: list[asyncio.Task] = []
    try:
        users = [
            await get_current_user_ws(ticket=await _issue_ticket(user_id), session_factory=session_factory)
            for user_id, _ in created
        ]
        assert engine.pool.checkedout() == 0
        assert users[0].username == names[0]  # объект отсоединён от сессии, но поля загружены

        await state_manager.initialize_game(
            game_id=77, white_id=users[0].id, black_id=users[1].id, base_time_ms=60000, increment_ms=0,
        )

        for user in users:
            socket = QueueSocket()
            sockets.append(socket)
            tasks.append(asyncio.create_task(matchmaking_endpoint(socket, user, session_factory)))

        # Все трое одновременно подключены и выполняют действие, которому нужна БД.
        for socket in sockets:
            socket.incoming.put_nowait({"action": "spectate_game", "game_id": 77})
        for socket in sockets:
            started = await socket.wait_for("spectate_started")
            assert started["white_username"] == names[0]

        # Соединения открыты, но ни одно соединение пула не занято.
        assert engine.pool.checkedout() == 0
    finally:
        for socket in sockets:
            socket.incoming.put_nowait(_CLOSE)
        # Отключение обрабатывает сам эндпоинт (manager.disconnect в ветке WebSocketDisconnect).
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.dispose()


@pytest.mark.parametrize("action_name", ["leave_queue", "spectate_game"])
async def test_each_action_gets_its_own_closed_session(action_name):
    """Каждое действие — своя сессия, закрытая к моменту, когда обработчик вернул управление."""
    from src.api.websockets import ACTION_HANDLERS, _dispatch_action

    opened: list = []

    class TrackingSession:
        def __init__(self):
            self.closed = False
            opened.append(self)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            self.closed = True
            return False

        def in_transaction(self):
            return False

        async def get(self, *args, **kwargs):
            return None

    await state_manager.initialize_game(game_id=78, white_id=1, black_id=2, base_time_ms=60000, increment_ms=0)
    user = User(id=3, username="tracker", bullet_rating=1500, blitz_rating=1500, rapid_rating=1500, classical_rating=1500)
    for _ in range(2):
        await _dispatch_action(
            TrackingSession, user, action_name, ACTION_HANDLERS[action_name], {"game_id": 78},
        )

    assert len(opened) == 2
    assert all(session.closed for session in opened)
