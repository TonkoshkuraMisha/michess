"""Parses a crosstable from Russian Wikipedia wikitext (one cell per line) and matches players to our ids.

    python ru_tables.py wiki/ru_x.txt [table index]      (run from the repo root)

Rows are aligned with the header by position: the score is the cell under «Очки», the results are the cells under
the numbered columns. Prints: our id (or NEW), the name as in the source, score, place, and whether the row's
result cells add up to the score. Importable: rows(path, index) -> list of (name, surname, score, place, cells_sum).
"""
import pathlib
import re
import sys

RU_CATALOG = pathlib.Path("frontend/src/i18n/messages/ru.ts")


def strip_style(cell: str) -> str:
    cell = cell.strip()
    # «style="..."|значение» → «значение»; «|» внутри [[ссылки]] не трогаем
    match = re.match(r'^(?:style|align|class|bgcolor|colspan|rowspan|width)\s*=\s*"[^"]*"\s*\|(.*)$', cell, flags=re.S)
    return (match.group(1) if match else cell).strip()


def number(cell: str) -> float | None:
    cell = re.sub(r"'''|<[^>]+>|&nbsp;|\s", "", cell).replace(",", ".")
    cell = cell.replace("½", ".5")
    if cell.startswith(".5"):
        cell = "0" + cell
    return float(cell) if re.fullmatch(r"\d+(\.5|\.0)?", cell) else None


def points(cell: str) -> float | None:
    cell = re.sub(r"'''|<[^>]+>|&nbsp;|\s", "", cell)
    if cell == "" or re.fullmatch(r"(\{\{[^}]*\}\}|[xXхХ*●■\-–—])+", cell):
        return 0.0
    if not re.fullmatch(r"[01½+\-–−=]+", cell):
        return None
    return cell.count("1") + cell.count("+") + 0.5 * cell.count("½")


def split_cells(part: str) -> list[str]:
    part = part.strip("\n")
    if not part:
        return []
    cells = re.split(r"\n[|!]", "\n" + part)[1:]
    out = []
    for cell in cells:
        # «a || b» в одной строке — несколько ячеек
        out.extend(strip_style(piece) for piece in re.split(r"\|\||!!", cell))
    return out


def rows(path: str, index: int = 0) -> list[tuple[str, str, float | None, str, float | None]]:
    text = pathlib.Path(path).read_text(encoding="utf-8")
    table = re.findall(r"\{\|.*?\n\s*\|\}", text, flags=re.S)[index]
    lines = [line.strip() for line in table.splitlines()]
    # без строки «{| class=…», закрывающей «|}» и подписи таблицы «|+ …»
    lines = [line for line in lines[1:] if line != "|}" and not line.startswith("|+")]
    parts = "\n".join(lines).split("\n|-")
    header = split_cells(parts[0])
    assert "Очки" in header, header
    score_at = header.index("Очки")
    place_at = header.index("Место") if "Место" in header else None
    result_at = [i for i, h in enumerate(header) if re.fullmatch(r"\d+", h)]
    out = []
    for part in parts[1:]:
        cells = split_cells(part)
        if not cells:
            continue
        if len(cells) != len(header):
            raise ValueError(f"row has {len(cells)} cells, header {len(header)}: {cells[:3]}")
        named = next(i for i, c in enumerate(cells) if "[[" in c or re.search(r"[А-Яа-яЁё]{4,}", c))
        link = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", cells[named])
        name = (link.group(1) if link else re.sub(r"\{\{[^}]*\}\}|'''", "", cells[named])).strip()
        name = re.sub(r"\s*\(.*?\)", "", name)
        surname = name.split(",")[0].strip() if "," in name else name.split()[-1]
        score = number(cells[score_at])
        place = re.sub(r"'''|\s", "", cells[place_at]) if place_at is not None else ""
        got = [points(cells[i]) for i in result_at]
        total = sum(g for g in got if g is not None) if all(g is not None for g in got) else None
        out.append((name, surname, score, place, total))
    return out


def catalog_ids() -> dict[str, list[str]]:
    """Russian surname -> our ids (guests by shortName/name, historical bots by profile name)."""
    text = RU_CATALOG.read_text(encoding="utf-8")
    found: dict[str, list[str]] = {}
    start = text.index("        guests: {\n")
    end = text.index("\n        },\n", start)
    entry = r"^            (\w+): \{name: '([^']*)', shortName: '([^']*)'"
    for gid, name, short in re.findall(entry, text[start:end], flags=re.M):
        for key in {name.split()[-1], short.split()[-1]}:
            found.setdefault(key.lower().replace("ё", "е"), []).append(gid)
    for bid, name in re.findall(r"^            (\w+): \{\n                name: '([^']*)',", text, flags=re.M):
        found.setdefault(name.split()[-1].lower().replace("ё", "е"), []).append("bot:" + bid)
    return found


if __name__ == "__main__":
    ids = catalog_ids()
    data = rows(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    total = 0.0
    for name, surname, score, place, cells_sum in data:
        key = surname.lower().replace("ё", "е")
        ours = ",".join(ids.get(key, [])) or "NEW"
        adds_up = cells_sum is not None and score is not None and abs(cells_sum - score) < 1e-9
        check = "?" if cells_sum is None else "ok" if adds_up else f"cells {cells_sum}"
        total += score or 0
        print(f"{ours:22} | {name[:34]:34} | {score!s:5} | {place:6} | {check}")
    n = len(data)
    print(f"players {n}, points {total}, single round robin would be {n * (n - 1) / 2}")
