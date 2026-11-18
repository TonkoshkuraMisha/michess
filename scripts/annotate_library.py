"""
Черновики аннотаций партий библиотеки (таск 27.4, этап 4): разметка движком тем же путём, что «Классика» 14.7
(scripts/build_classics.py: оценка каждой позиции, объяснение наставника кодами coach.* к ошибкам и тактическим
идеям). Пишется аннотация со статусом auto; аннотации, которые уже правил человек (draft / review / approved), не
трогаются. Нужен Stockfish; в CI не запускается.

    python scripts/annotate_library.py --collection "Красивые партии" [--limit 200] [--depth 14] [--workers 4]
"""

import argparse
import asyncio
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _analyse(job: tuple[int, str, int]) -> tuple[int, dict | None]:
    """Оценивает ходы партии движком и собирает черновые комментарии наставника."""
    from build_classics import analyse

    game_id, pgn, depth = job
    try:
        data = analyse({"pgn": pgn, "stops": []}, depth)
    except Exception as exc:  # noqa: BLE001 — одна неразборчивая партия не останавливает остальные
        print(f"[!] {game_id}: {exc}", flush=True)
        return game_id, None
    return game_id, {"evals": data["evals"], "comments": data["comments"]}


async def _select(collection: str, limit: int) -> list[tuple[int, str]]:
    """Отбирает публичные партии библиотеки, у которых ещё нет автоаннотации."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.library import LibraryAnnotation, LibraryCollection, LibraryGame, LibraryGameCollection
    from src.services import library

    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    async with async_sessionmaker(engine)() as db:
        query = (select(LibraryGame).join(LibraryGameCollection, LibraryGameCollection.game_id == LibraryGame.id)
                 .join(LibraryCollection, LibraryCollection.id == LibraryGameCollection.collection_id)
                 .where(LibraryCollection.path.ilike(f"%{collection}%"), LibraryGame.plies >= 20)
                 .where(~LibraryGame.id.in_(select(LibraryAnnotation.game_id).where(LibraryAnnotation.status != "auto")))
                 .distinct().order_by(LibraryGame.id).limit(limit))
        games = (await db.execute(query)).scalars().all()
        jobs = [(g.id, library.to_pgn(g)) for g in games]
    await engine.dispose()
    return jobs


async def _save(results: list[tuple[int, dict]]) -> None:
    """Сохраняет сгенерированную аннотацию партии в таблицу library_annotations."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.library import LibraryAnnotation

    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    async with async_sessionmaker(engine)() as db:
        for game_id, body in results:
            current = await db.scalar(select(LibraryAnnotation).where(LibraryAnnotation.game_id == game_id))
            if current is None:
                db.add(LibraryAnnotation(game_id=game_id, status="auto", body=body))
            elif current.status == "auto":
                current.body = body
                current.version += 1
        await db.commit()
    await engine.dispose()


def main() -> None:
    """Запускает пакетную разметку партий библиотеки комментариями наставника."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--collection", required=True, help="часть пути коллекции")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--depth", type=int, default=14)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    jobs = asyncio.run(_select(args.collection, args.limit))
    print(f"партий: {len(jobs)}", flush=True)
    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(_analyse, (game_id, pgn, args.depth)) for game_id, pgn in jobs]
        for index, future in enumerate(as_completed(futures), start=1):
            game_id, body = future.result()
            if body is not None:
                results.append((game_id, body))
            if index % 10 == 0:
                print(f"  {index}/{len(jobs)}", flush=True)
    asyncio.run(_save(results))
    print(f"аннотаций записано: {len(results)}")


if __name__ == "__main__":
    main()
