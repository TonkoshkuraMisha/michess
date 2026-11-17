"""Checks the St. Petersburg 1914 final against the fetched table: final-only score = total - carried-over score,
and it equals the sum of the row's result cells. python verify_final.py batch11.json"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
text = (HERE / ".cache" / "st_petersburg_1914_chess_tournament.txt").read_text(encoding="utf-8")
table = re.findall(r"\{\|.*?\n\|\}", text, flags=re.S)[1]


def num(cell: str) -> float:
    cell = cell.split("\n")[0].strip().replace("½", ".5")
    return float("0" + cell if cell.startswith(".") else cell)


rows = []
for row in table.split("\n|-")[1:]:
    link = re.search(r"\[\[([^\]|]+)", row)
    if not link:
        continue
    cells = [c.strip() for c in row.split("||")]
    carried, results, total = num(cells[2]), cells[3:-1], num(cells[-1])
    played = sum(c.count("1") + 0.5 * c.count("½") for c in results if "*" not in c)
    rows.append((link.group(1).split()[-1].lower(), carried, played, total))

batch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
ours = batch["events"][0]["table"]
ok = len(rows) == len(ours)
for (name, carried, played, total), (player, score) in zip(rows, ours, strict=False):
    good = name == player and abs(total - carried - score) < 1e-9 and abs(played - score) < 1e-9
    ok = ok and good
    print(f"{player:11} source: carried {carried} + final {played} = {total} | ours {score} | {'OK' if good else 'MISMATCH'}")
print("ALL OK" if ok and sum(s for _, s in ours) == 20 else "FAILED")
