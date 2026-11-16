"""
Дополнение выборки задач для тем без тега в базе (таск 27.8) → data/puzzles/lichess_themes_extra.csv.gz.

Основная выборка (build_puzzle_subset.py) квотирует только темы с тегами базы lichess. Здесь та же открытая база
(lichess_db_puzzle.csv.zst, CC0) читается потоком, и для задач хорошего качества (мягкий фильтр ``acceptable``)
считаются темы реестра целиком — с распознавателями src/services/theme_detectors.py и классификатором матов. Каждая
тема, которой в основной выборке не хватает до минимума ступени, получает свою квоту на ступень. Задачи основной
выборки пропускаются. Отбор детерминирован (--seed). Нужен пакет zstandard; в CI не запускается.

    uv run --with zstandard python -m scripts.dev.build_theme_extra path/to/lichess_db_puzzle.csv.zst
"""

import argparse
import csv
import gzip
import io
import pathlib
import random
import sys
from collections import Counter

from scripts.dev.build_puzzle_subset import FIELDS, Reservoir, acceptable
from src.services import theme_detectors
from src.services.mate_patterns import patterns_for_solution
from src.services.puzzle_import import read_subset, stage_for, themes_for_row
from src.services.themes import THEMES, themes_for_lichess_tags

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "lichess_themes_extra.csv.gz"


def shortages() -> dict[tuple[str, int], int]:
    """Сколько задач не хватает каждой теме на каждой ступени в основной выборке."""
    have: Counter[tuple[str, int]] = Counter()
    for row in read_subset():
        stage = stage_for(int(row["Rating"]), row["Moves"].split())
        for code in themes_for_row(row):
            have[(code, stage)] += 1
    need = {}
    for theme in THEMES:
        for stage, minimum in enumerate(theme.minimums, start=1):
            if minimum and have[(theme.code, stage)] < minimum:
                need[(theme.code, stage)] = minimum - have[(theme.code, stage)] + 5  # с запасом
    return need


def quick_themes(row: dict) -> set[str]:
    """Темы для отбора — без детектора мотивов (он медленный; полную разметку делает импорт)."""
    tags = row["Themes"].split()
    moves = row["Moves"].split()
    codes = set(themes_for_lichess_tags(tags)) | set(theme_detectors.detect(row["FEN"], moves, tags))
    if "mate" in tags:
        codes |= set(patterns_for_solution(row["FEN"], moves))
    return codes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("--seed", type=int, default=27)
    parser.add_argument("--limit", type=int, default=None, help="прочитать не больше N строк (проверка)")
    args = parser.parse_args()
    import zstandard  # только для сборки

    known = {row["PuzzleId"] for row in read_subset()}
    need = shortages()
    print(f"тем × ступеней с нехваткой: {len(need)}", flush=True)
    rng = random.Random(args.seed)
    pools = {key: Reservoir(count, rng) for key, count in need.items()}
    wanted = {code for code, _ in need}
    seen = 0
    with args.source.open("rb") as raw:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8")
        for row in csv.DictReader(text):
            seen += 1
            if args.limit and seen > args.limit:
                break
            if seen % 500_000 == 0:
                print(f"  {seen} строк", flush=True)
            if row["PuzzleId"] in known or not acceptable(row):
                continue
            codes = quick_themes(row) & wanted
            if not codes:
                continue
            stage = stage_for(int(row["Rating"]), row["Moves"].split())
            for code in codes:
                pool = pools.get((code, stage))
                if pool is not None:
                    pool.offer({field: row[field] for field in FIELDS})
    chosen: dict[str, dict] = {}
    for pool in pools.values():
        for item in pool.items:
            chosen.setdefault(item["PuzzleId"], item)
    rows = sorted(chosen.values(), key=lambda r: r["PuzzleId"])
    with gzip.open(OUTPUT, "wt", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    filled = Counter()
    for (code, _stage), pool in pools.items():
        filled[code] += len(pool.items)
    print(f"прочитано {seen}, задач в дополнении: {len(rows)} → {OUTPUT}")
    for code, count in sorted(filled.items(), key=lambda item: item[1]):
        print(f"  {code:28} {count}")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
