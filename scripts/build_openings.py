# --- FILE: scripts/build_openings.py ---
"""
Таблица дебютов (таск 16.1) из открытого набора lichess-org/chess-openings (CC0-1.0, см. ATTRIBUTION.md):
файлы a.tsv … e.tsv (eco, name, pgn) превращаются в src/services/data/openings.tsv — код ECO, название, позиция (EPD
без счётчиков) и число полуходов. Определение дебюта идёт по позиции, поэтому перестановки ходов узнаются.

    python scripts/build_openings.py <папка с a.tsv … e.tsv>
"""

import csv
import io
import sys
from pathlib import Path

import chess.pgn

OUT = Path(__file__).resolve().parents[1] / "src" / "services" / "data" / "openings.tsv"


def main() -> None:
    source = Path(sys.argv[1])
    rows: dict[str, tuple[str, str, int]] = {}
    for name in "abcde":
        with (source / f"{name}.tsv").open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                game = chess.pgn.read_game(io.StringIO(row["pgn"]))
                assert game is not None, row
                board = game.board()
                plies = 0
                for move in game.mainline_moves():
                    board.push(move)
                    plies += 1
                # Одна позиция — одно название: у более короткой записи приоритет (как в исходном наборе).
                key = board.epd()
                if key not in rows or plies < rows[key][2]:
                    rows[key] = (row["eco"], row["name"], plies)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as handle:
        handle.write("eco\tname\tepd\tplies\n")
        for epd, (eco, name, plies) in sorted(rows.items(), key=lambda item: (item[1][0], item[1][2], item[1][1])):
            handle.write(f"{eco}\t{name}\t{epd}\t{plies}\n")
    print(f"{len(rows)} позиций → {OUT}")


if __name__ == "__main__":
    main()
