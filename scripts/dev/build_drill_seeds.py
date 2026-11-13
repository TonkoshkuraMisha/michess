# --- FILE: scripts/dev/build_drill_seeds.py ---
"""
Таблица seed для упражнений-генераторов (таск 13.7) → data/drills/seeds.json.

Для каждого сочетания «вид × фигура × уровень» перебираются seed подряд, пока не наберётся ``--per-combo`` позиций с
единственным верным ответом (src/services/drill_generator.py). Сервер берёт seed из таблицы и восстанавливает
упражнение одной попыткой — быстро даже для мата в 2, а редкие сочетания (мат конём, угроза мата слоном) не
заставляют игрока ждать перебора. Детерминировано: та же версия генератора даёт ту же таблицу.

    python -m scripts.dev.build_drill_seeds [--per-combo 40] [--max-seed 400000]
"""

import argparse
import json
import pathlib
import time
from concurrent.futures import ProcessPoolExecutor

from src.services.drill_generator import KINDS, LEVELS, PIECES, build, supported

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "drills" / "seeds.json"


def find(args: tuple[str, str, int, int, int]) -> tuple[str, list[int]]:
    kind, piece, level, need, max_seed = args
    seeds: list[int] = []
    seed = 0
    while len(seeds) < need and seed < max_seed:
        if build(kind, piece, level, seed) is not None:
            seeds.append(seed)
        seed += 1
    return f"{kind}.{piece}.{level}", seeds


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-combo", type=int, default=40)
    parser.add_argument("--max-seed", type=int, default=400_000)
    parser.add_argument("--only", nargs="*", default=None,
                        help="пересобрать только эти сочетания (вид.фигура.уровень), остальные оставить из файла")
    args = parser.parse_args()
    combos = [(k, p, lv, args.per_combo, args.max_seed)
              for k in KINDS for p in PIECES for lv in LEVELS if supported(k, p)]
    table: dict[str, list[int]] = {}
    if args.only:
        table = json.loads(OUTPUT.read_text(encoding="utf-8"))
        combos = [c for c in combos if f"{c[0]}.{c[1]}.{c[2]}" in args.only]
    started = time.monotonic()
    with ProcessPoolExecutor() as pool:
        for key, seeds in pool.map(find, combos):
            table[key] = seeds
            print(f"{key}: {len(seeds)} ({time.monotonic() - started:.0f}s)", flush=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(dict(sorted(table.items())), separators=(",", ":")) + "\n", encoding="utf-8")
    short = {k: len(v) for k, v in table.items() if len(v) < args.per_combo}
    print(f"Written {sum(len(v) for v in table.values())} seeds for {len(table)} combos; short: {short}")


if __name__ == "__main__":
    main()
