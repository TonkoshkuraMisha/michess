"""Checks a batch against the fetched Wikipedia tables: same players in the same order with the same totals.

    python verify_batch.py batch8.json

For every event: the wikitext table rows are parsed (surname of the linked player + the total cell), rows of
withdrawn players without a total are skipped, and the result is compared with the batch table row by row.
Also checks that every row's result cells add up to its total (crosstable self-consistency).
"""
import json
import pathlib
import re
import sys
import unicodedata

HERE = pathlib.Path(__file__).parent
SOURCES = {
    "berlin_1881": ("berlin_1881_chess_tournament", 0),
    "cambridge_springs_1904": ("1904_cambridge_springs_international_chess_congress", 0),
    "monte_carlo_1904": ("monte_carlo_chess_tournament", 3),
    "ostend_1907": ("ostend_1907_chess_tournament", 0),
    "prague_1908": ("prague_1908_chess_tournament", 0),
    "vienna_1908": ("vienna_1908_chess_tournament", 0),
    "hamburg_1910": ("hamburg_1910_chess_tournament", 0),
    "san_sebastian_1912": ("san_sebasti_n_chess_tournament", 1),
    "moravska_ostrava_1923": ("moravsk_ostrava_1923_chess_tournament", 0),
    "berlin_1897": ("berlin_1897_chess_tournament", 0),
    "san_remo_1930": ("san_remo_1930_chess_tournament", 0),
    "new_york_1889": ("new_york_1889_chess_tournament", 5),
    "kyiv_1903": ("kiev_1903_chess_tournament", 0),
}
# id в партии -> как фамилия записана в источнике (без диакритики, нижний регистр)
ALIASES = {
    "paulsen": "louis paulsen", "paulsen_w": "wilfried paulsen", "schwarz_jacques": "schwarz", "schutz": "schuetz",
    "dus_chotimirsky": "duz-khotimirsky", "suchting": "suchting", "rabinovich_abram": "rabinovich",
    "treybal_frantisek": "treybal", "johner_paul": "johner", "cohn_erich": "cohn", "kohnlein": "kohnlein",
    "grunfeld": "grunfeld", "bogoljubow": "bogoljubo", "prokes": "prokes", "kvicala": "kvicala", "pokorny": "pokorny",
    "hromadka": "hromadka", "romih": "romi", "forgacs": "forgacs", "maroczy": "maroczy", "reti": "reti",
    "baird": "david baird", "baird_john": "john baird", "znosko_borovsky": "znosko-borovsky",
}


def plain(text: str) -> str:
    """Очищает содержимое ячейки от HTML-тегов, сносок и пробелов."""
    text = text.replace("ø", "o").replace("ł", "l").replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def number(cell: str) -> float | None:
    """Преобразует текстовую запись очков с символом ½ в float."""
    cell = re.sub(r"'''|<[^>]+>|&nbsp;", " ", cell).strip()
    cell = re.sub(r"\{\{frac\|(\d)\|(\d)\}\}", lambda m: f" {int(m.group(1)) / int(m.group(2))}", cell)
    cell = cell.replace("{{frac|2}}", "½").replace("½", ".5")
    cell = cell.replace(" ", "")
    if cell.startswith(".5"):
        cell = "0" + cell
    match = re.fullmatch(r"(\d+)(\.5|\.0)?", cell)
    return float(match.group(0)) if match else None


def result_points(cell: str) -> float | None:
    """Points in one crosstable cell: '1', '½', '0', '1½10' (several games), 'x'/'*'/'-' -> 0."""
    cell = cell.replace("{{frac|1|2}}", "½").replace("{{frac|2}}", "½")
    cell = re.sub(r"'''|<[^>]+>|\{\{[^}]*\}\}|style=[^|]*\|", "", cell).strip()
    if cell == "" or re.fullmatch(r"[xX*\-–\s]+", cell):
        return 0.0
    if not re.fullmatch(r"[01½\-–+=]+", cell):
        return None
    # «+» — партия, засчитанная без игры (соперник выбыл): очко.
    return cell.count("1") + cell.count("+") + 0.5 * cell.count("½")


def rows_of(slug: str, index: int) -> list[tuple[str, float | None, float | None]]:
    """Разбирает кросс-таблицу английской Википедии в список строк игроков."""
    text = (HERE / ".cache" / f"{slug}.txt").read_text(encoding="utf-8")
    table = re.findall(r"\{\|.*?\n\|\}", text, flags=re.S)[index]
    out = []
    for row in table.split("\n|-")[1:]:
        row = row.replace("\n||", "||")  # строка, перенесённая перед разделителем ячеек
        cells =[c.strip() for c in re.split(r"\|\||\n\|", "\n" + row.strip().lstrip("|")) if c.strip() != ""]
        named = next((i for i, c in enumerate(cells)
                      if re.search(r"[A-Za-z]{4,}", re.sub(r"style=[^|]*\||align=\w+\|", "", c))), None)
        if named is None:
            continue
        name_cell = cells[named]
        link = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", name_cell)
        ext = re.search(r"\[https?://\S+ ([^\]]+)\]", name_cell)
        if link:
            name = link.group(2) or link.group(1)
        elif ext:
            name = ext.group(1)
        else:
            name = re.sub(r"\{\{flagathlete\|\s*([^|]+)\|.*", r"\1", name_cell)
        name = plain(re.sub(r"\s*\(.*?\)", "", name)).strip()
        rest = cells[named + 1:]
        while rest and number(rest[0]) is None and result_points(rest[0]) is None:
            rest = rest[1:]  # колонки города и страны
        # итог — последняя ячейка-число; после него могут идти призы
        total_at = None
        for i in range(len(rest) - 1, -1, -1):
            if "$" in rest[i] or rest[i] in ("}",):
                continue
            total_at = i
            break
        total = number(rest[total_at]) if total_at is not None else None
        points = [result_points(c) for c in rest[:total_at]] if total_at is not None else []
        cross = sum(p for p in points if p is not None) if points and all(p is not None for p in points) else None
        out.append((name, total, cross))
    return out


batch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
bad = 0
for event in batch["events"]:
    slug, index = SOURCES[event["key"]]
    # Выбывшие, чьи партии аннулированы (в строках остальных участников — прочерки).
    withdrawn = {'hamburg_1910': ('jacob',)}.get(event['key'], ())
    source = [(n, t, c) for n, t, c in rows_of(slug, index) if t is not None and not any(w in n for w in withdrawn)]
    ours = event["table"]
    status = []
    if len(source) != len(ours):
        status.append(f"rows {len(source)} vs {len(ours)}")
    for (name, total, cross), (player, score) in zip(source, ours, strict=False):
        want = ALIASES.get(player, player)
        if want.split()[-1] not in name or (" " in want and want.split()[0] not in name):
            status.append(f"name {player} vs '{name}'")
        if total != float(score):
            status.append(f"score {player}: {score} vs source {total}")
        if cross is None:
            status.append(f"row {player}: cells not parsed")
        elif abs(cross - total) > 1e-9:
            status.append(f"row {player}: cells add to {cross}, total {total}")
    n = len(ours)
    games = n * (n - 1) // 2 * event.get("cycles", 1)
    total_points = sum(float(s) for _, s in ours)
    verdict = "OK" if not status else "; ".join(status)
    print(f"{event['key']:24} players {n:2} points {total_points:5} of {games:3} games | {verdict}")
    bad += bool(status)
print("FAILED" if bad else "ALL OK")
