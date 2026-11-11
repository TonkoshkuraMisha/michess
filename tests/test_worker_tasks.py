# --- FILE: tests/test_worker_tasks.py ---
"""
Celery-задача анализа: каждая задача идёт в собственном asyncio.run, поэтому глобальный
пул соединений использовать нельзя — со второй задачи он ломался («different loop»).
"""

import asyncio
import json

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.models.base import Base
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.bots.base import resolve_stockfish_path
from src.worker import tasks

PGN = '[Event "t"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'


async def _prepare_db(url: str) -> list[int]:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        white = User(
            username="worker_w", hashed_password="pw", bullet_rating=1500,
            blitz_rating=1500, rapid_rating=1500, classical_rating=1500
        )
        black = User(
            username="worker_b", hashed_password="pw", bullet_rating=1500,
            blitz_rating=1500, rapid_rating=1500, classical_rating=1500
        )
        db.add_all([white, black])
        await db.commit()
        games = [
            Game(white_player_id=white.id, black_player_id=black.id, status=GameStatus.COMPLETED,
                 base_time_ms=180000, increment_ms=0, is_rated=True, pgn=PGN)
            for _ in range(2)
        ]
        db.add_all(games)
        await db.commit()
        ids = [g.id for g in games]
    await engine.dispose()
    return ids


async def _cached_analysis(url: str, game_id: int) -> str | None:
    engine = create_async_engine(url)
    async with async_sessionmaker(engine)() as db:
        game = await db.get(Game, game_id)
        value = game.analysis_json
    await engine.dispose()
    return value


@pytest.mark.skipif(resolve_stockfish_path() is None, reason="Stockfish binary not available")
def test_consecutive_tasks_each_in_own_event_loop(tmp_path, monkeypatch):
    url = f"sqlite+aiosqlite:///{(tmp_path / 'worker.db').as_posix()}"
    game_ids = asyncio.run(_prepare_db(url))
    monkeypatch.setattr(tasks, "_task_database_url", lambda: url)

    for game_id in game_ids:  # две задачи подряд — как в живом воркере
        report = tasks.analyze_game_task(game_id)
        assert report.get("status") != "error"
        assert len(report["moves"]) == 7

    for game_id in game_ids:
        assert json.loads(asyncio.run(_cached_analysis(url, game_id)))["moves"]
