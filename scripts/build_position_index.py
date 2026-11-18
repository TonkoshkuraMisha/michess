# --- FILE: scripts/build_position_index.py ---
"""
Индекс позиций (таск 16.1) по уже сыгранным партиям: архив и всё законченное до появления индекса. Новые партии
индексирует задача Celery при завершении — скрипт нужен один раз (и безопасен при повторе: партия с флагом
games.positions_indexed пропускается).

    python scripts/build_position_index.py [--batch 500]
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main(batch: int) -> None:
    """Индексирует первые 30 полуходов партий архива в таблицы позиций."""
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.game import Game, GameStatus
    from src.services.position_index import index_game

    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    pending = (Game.status == GameStatus.COMPLETED) & Game.positions_indexed.is_(False)
    started = time.monotonic()
    async with sessions() as db:
        total = await db.scalar(select(func.count()).select_from(Game).where(pending)) or 0
        done = added = 0
        last_id = 0
        while True:
            games = (await db.execute(
                select(Game).where(pending, Game.id > last_id).order_by(Game.id).limit(batch)
            )).scalars().all()
            if not games:
                break
            for game in games:
                added += await index_game(db, game)
            await db.commit()
            last_id = games[-1].id
            done += len(games)
            print(f"{done}/{total} партий, в индексе {added} ({time.monotonic() - started:.0f} с)", flush=True)
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--batch", type=int, default=500)
    asyncio.run(main(parser.parse_args().batch))
