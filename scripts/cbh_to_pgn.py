"""
Перевод учебных баз закрытого формата в PGN (таск 27.3): все `*.cbh` папки рекурсивно → `<выход>/<та же папка>/<имя>.pgn`
(только заголовки и главная линия). Затем PGN грузятся в библиотеку обычным импортом:

    python scripts/cbh_to_pgn.py <папка> <папка-для-pgn>
    python scripts/import_library.py <папка-для-pgn> --collection "Партии мастеров"

Базы-архивы (`.cbv`) и базы другой программы (`.cib`) не читаются — о них печатается список. Разбор — в
src/services/cbh_reader.py.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.cbh_reader import Database, DecodeError  # noqa: E402


def convert(source: Path, target: Path) -> None:
    converted = failed = 0
    for cbh in sorted(source.rglob("*")):
        if cbh.suffix.lower() != ".cbh" or not cbh.with_suffix(".cbg").exists():
            continue
        out = target / cbh.relative_to(source).with_suffix(".pgn")
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            db = Database.open(cbh)
            with out.open("w", encoding="utf-8") as handle:
                for game in db:
                    print(game, file=handle, end="\n\n")
        except (DecodeError, OSError) as exc:
            failed += 1
            print(f"FAILED {cbh.relative_to(source)}: {exc}")
            continue
        converted += 1
        s = db.stats
        print(f"{cbh.relative_to(source)}: {s.games} games ({db.encoding}); skipped: not from the initial position "
              f"{s.not_initial}, deleted {s.deleted}, unsupported {s.unsupported}, errors {s.errors}")
        for reason in s.reasons[:3]:
            print(f"    {reason}")
    others = sorted(p.relative_to(source) for p in source.rglob("*")
                    if p.suffix.lower() in (".cbv", ".cib") and not p.with_suffix(".cbh").exists())
    print(f"done: {converted} bases converted, {failed} failed")
    if others:
        print("not readable (archives or another program's format):")
        for path in others:
            print(f"    {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    if not args.source.is_dir():
        raise SystemExit(f"not a folder: {args.source}")
    convert(args.source, args.target)


if __name__ == "__main__":
    main()
