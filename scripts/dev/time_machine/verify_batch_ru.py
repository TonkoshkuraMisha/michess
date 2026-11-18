"""Checks a batch against tables fetched from Russian Wikipedia: same player in every row (surname and first name),
same score, and the row's result cells add up to the score. Run from the repo root:

    python verify_batch_ru.py batch12.json
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ru_tables import RU_CATALOG, rows  # noqa: E402

HERE = pathlib.Path(__file__).parent
SOURCES = {
    "london_1922": ("ru_london_1922", 0),
    "baden_baden_1925": ("ru_baden_baden_1925", 0),
    "semmering_1926": ("ru_semmering_1926", 0),
    "goteborg_1920": ("ru_goteborg_1920", 0),
    "vienna_1922": ("ru_vienna_1922", 0),
    "copenhagen_1923": ("ru_copenhagen_1923", 0),
}
# Разные записи одного имени в источнике и в нашем каталоге.
FIRST_NAMES = {"ханс": "ганс", "чарлз": "чарльз", "бора": "борис"}


def norm(text: str) -> str:
    """Нормализует имя и фамилию шахматиста для сверки с русским каталогом."""
    return text.lower().replace("ё", "е").strip()


def ru_names(batch: dict) -> dict[str, str]:
    """id -> полное русское имя: мастера прошлого и исторические боты из каталога, новые — из партии."""
    text = RU_CATALOG.read_text(encoding="utf-8")
    names: dict[str, str] = {}
    start = text.index("        guests: {\n")
    end = text.index("\n        },\n", start)
    for gid, name in re.findall(r"^            (\w+): \{name: '([^']*)'", text[start:end], flags=re.M):
        names[gid] = name
    for bid, name in re.findall(r"^            (\w+): \{\n                name: '([^']*)',", text, flags=re.M):
        names.setdefault(bid, name)
    for guest in batch["guests"]:
        names[guest["id"]] = guest["ru"][0]
    return names


batch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
names = ru_names(batch)
bad = 0
for event in batch["events"]:
    slug, index = SOURCES[event["key"]]
    source = rows(str(HERE / ".cache" / f"{slug}.txt"), index)
    ours = event["table"]
    status = []
    if len(source) != len(ours):
        status.append(f"rows {len(source)} vs {len(ours)}")
    for (name, surname, score, _place, cells_sum), (player, our_score) in zip(source, ours, strict=False):
        ru = names.get(player)
        if ru is None:
            status.append(f"{player}: no Russian name")
            continue
        first = norm(name.split(",")[1].split()[0]) if "," in name else ""
        first = FIRST_NAMES.get(first, first)
        words = [norm(w) for w in ru.split()]
        if norm(surname) not in words or (first and first not in words):
            status.append(f"name {player} «{ru}» vs source «{name}»")
        if score != float(our_score):
            status.append(f"score {player}: {our_score} vs source {score}")
        if cells_sum is None or abs(cells_sum - score) > 1e-9:
            status.append(f"row {player}: cells add to {cells_sum}, score {score}")
    n = len(ours)
    games = n * (n - 1) // 2 * event.get("cycles", 1)
    total = sum(float(s) for _, s in ours)
    print(f"{event['key']:20} players {n:2} points {total:5} of {games:3} games | {'OK' if not status else '; '.join(status)}")
    bad += bool(status)
print("FAILED" if bad else "ALL OK")
