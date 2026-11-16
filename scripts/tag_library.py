"""
Разметка библиотеки партий (таск 27.5): пешечная структура каждой партии (src/services/pawn_structures.py).
Импорт размечает новые партии сам; скрипт — для уже загруженных и после правки правил.

    python scripts/tag_library.py [--all]   # --all — пересчитать и уже размеченные
"""

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(recompute: bool) -> None:
    import chess
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.library import LibraryGame
    from src.services import pawn_structures

    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    counts: Counter[str | None] = Counter()
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        query = select(LibraryGame).where(LibraryGame.start_fen.is_(None))
        if not recompute:
            query = query.where(LibraryGame.structure.is_(None))
        games = (await db.execute(query)).scalars().all()
        for index, game in enumerate(games, start=1):
            game.structure = pawn_structures.game_structure(chess.Move.from_uci(u) for u in game.moves.split())
            counts[game.structure] += 1
            if index % 1000 == 0:
                await db.commit()
        await db.commit()
    await engine.dispose()
    print(f"games: {sum(counts.values())}")
    for code, count in counts.most_common():
        print(f"  {code or '—':16} {count}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true")
    asyncio.run(run(parser.parse_args().all))


if __name__ == "__main__":
    main()
