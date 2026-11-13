# --- FILE: scripts/dev/build_puzzle_subset.py ---
"""
Выборка задач из открытой базы lichess (таск 13.1) → data/puzzles/lichess_subset.csv.gz.

База: https://database.lichess.org/#puzzles (lichess_db_puzzle.csv.zst, лицензия CC0). Скрипт читает её потоком и
отбирает задачи хорошего качества (устойчивый рейтинг, высокая популярность, много решений) так, чтобы:
* рейтинг 600–2600 был покрыт равномерно — 20 корзин по 100 пунктов, по ``--per-bucket`` задач в каждой;
* у каждого тега, который реестр тем (src/services/themes.py) переводит в свою тему, было не меньше ``--per-tag``
  задач (сколько найдётся), — редкие темы не тонут среди частых.

Отбор детерминирован (``--seed``): повторный запуск на той же базе даёт ту же выборку. Нужен пакет zstandard
(только для этого скрипта; сервер его не использует). В CI не запускается.

    python -m scripts.dev.build_puzzle_subset path/to/lichess_db_puzzle.csv.zst
"""

import argparse
import csv
import gzip
import io
import pathlib
import random
import sys

from src.services.themes import LICHESS_TAG_TO_THEMES

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "lichess_subset.csv.gz"
FIELDS = ("PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes")
RATING_MIN, RATING_MAX, BUCKET = 600, 2600, 100


def good(row: dict) -> bool:
    return (int(row["RatingDeviation"]) <= 80 and int(row["Popularity"]) >= 85 and int(row["NbPlays"]) >= 300
            and RATING_MIN <= int(row["Rating"]) < RATING_MAX)


class Reservoir:
    """Равномерная случайная выборка фиксированного размера из потока (алгоритм R)."""

    def __init__(self, size: int, rng: random.Random):
        self.size, self.rng, self.seen, self.items = size, rng, 0, []

    def offer(self, item: dict) -> None:
        self.seen += 1
        if len(self.items) < self.size:
            self.items.append(item)
        else:
            index = self.rng.randrange(self.seen)
            if index < self.size:
                self.items[index] = item


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--per-bucket", type=int, default=900)
    parser.add_argument("--per-tag", type=int, default=150)
    parser.add_argument("--seed", type=int, default=13)
    args = parser.parse_args()

    import zstandard  # только для сборки выборки

    rng = random.Random(args.seed)
    buckets = {low: Reservoir(args.per_bucket, rng) for low in range(RATING_MIN, RATING_MAX, BUCKET)}
    tags = {tag: Reservoir(args.per_tag, rng) for tag in LICHESS_TAG_TO_THEMES}
    total = kept = 0
    with args.source.open("rb") as raw:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8")
        for row in csv.DictReader(text):
            total += 1
            if not good(row):
                continue
            kept += 1
            item = {field: row[field] for field in FIELDS}
            buckets[(int(row["Rating"]) - RATING_MIN) // BUCKET * BUCKET + RATING_MIN].offer(item)
            for tag in row["Themes"].split():
                if tag in tags:
                    tags[tag].offer(item)

    chosen: dict[str, dict] = {}
    for reservoir in [*tags.values(), *buckets.values()]:
        for item in reservoir.items:
            chosen.setdefault(item["PuzzleId"], item)
    rows = sorted(chosen.values(), key=lambda r: r["PuzzleId"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUTPUT, "wt", encoding="utf-8", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Прочитано {total}, подходит по качеству {kept}, в выборке {len(rows)} → {OUTPUT}", file=sys.stderr)
    thin = {tag: len(r.items) for tag, r in tags.items() if len(r.items) < args.per_tag}
    if thin:
        print(f"Тегов с неполной квотой: {thin}", file=sys.stderr)


if __name__ == "__main__":
    main()
