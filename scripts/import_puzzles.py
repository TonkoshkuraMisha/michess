# --- FILE: scripts/import_puzzles.py ---
"""
Загрузка базы задач (таск 13.1) из data/puzzles/lichess_subset.csv.gz и защитных упражнений (таск 13.6) из
data/puzzles/defense_drills.csv.gz в базу данных сервера. Запускается после
миграций при развёртывании (идемпотентно: уже загруженные задачи пропускаются).

    python -m scripts.import_puzzles [--limit N]
"""

import argparse
import asyncio
import itertools
import time

from src.db.session import AsyncSessionLocal
from src.services.defense_drills import import_drills, read_drills
from src.services.puzzle_import import import_rows, read_subset, retag_outdated


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=None, help="загрузить не больше N задач (для проверки)")
    args = parser.parse_args()
    rows = read_subset()
    if args.limit:
        rows = itertools.islice(rows, args.limit)
    started = time.monotonic()
    async with AsyncSessionLocal() as db:
        added, skipped = await import_rows(db, rows)
        retagged = await retag_outdated(db)
        drills = await import_drills(db, read_drills())
    print(f"Puzzles: added {added}, skipped {skipped}, retagged {retagged} in {time.monotonic() - started:.1f}s")
    print("Defense drills: " + ", ".join(f"{name} {count}" for name, count in drills.items()))


if __name__ == "__main__":
    asyncio.run(main())
