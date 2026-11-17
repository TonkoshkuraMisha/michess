"""Stricter re-check of the events already in the registry against English Wikipedia tables.

    PYTHONPATH=. python reverify_all.py            (from the repo root)

For every round-robin event with a fetched source page: the same number of rows, and in every row the surname AND
the first name of the source match our participant (PGN name of a master of the past, or the bot's name), the score
matches, and the row's result cells add up to the score (when the cells can be parsed).
"""
import pathlib
import re
import sys
import unicodedata

from src.api.bots import BOT_METADATA
from src.services.bots.guests import GUESTS_BY_ID
from src.services.time_machine import EVENTS

HERE = pathlib.Path(__file__).parent
SOURCES = {
    "london_1862": ("london_1862_chess_tournament", 0),
    "paris_1867": ("paris_1867_chess_tournament", 0),
    "baden_baden_1870": ("baden_baden_1870_chess_tournament", 0),
    "paris_1878": ("paris_1878_chess_tournament", 0),
    "vienna_1882": ("vienna_1882_chess_tournament", 0),
    "london_1883": ("london_1883_chess_tournament", 0),
    "hastings_1895": ("hastings_1895_chess_tournament", 0),
    "st_petersburg_1895": ("saint_petersburg_1895_96_chess_tournament", 0),
    "nuremberg_1896": ("nuremberg_1896_chess_tournament", 0),
    "vienna_1898": ("vienna_1898_chess_tournament", 0),
    "london_1899": ("london_1899_chess_tournament", 0),
    "paris_1900": ("paris_1900_chess_tournament", 0),
    "monte_carlo_1903": ("monte_carlo_chess_tournament", 2),
    "carlsbad_1907": ("carlsbad_1907_chess_tournament", 0),
    "san_sebastian_1911": ("san_sebasti_n_chess_tournament", 0),
    "carlsbad_1911": ("carlsbad_1911_chess_tournament", 0),
    "mannheim_1914": ("mannheim_1914_chess_tournament", 0),
    "st_petersburg_1914": ("st_petersburg_1914_chess_tournament", 0),
    "carlsbad_1923": ("carlsbad_1923_chess_tournament", 0),
    "new_york_1924": ("new_york_1924_chess_tournament", 0),
    "moscow_1925": ("moscow_1925_chess_tournament", 0),
    "new_york_1927": ("new_york_1927_chess_tournament", 0),
    "bad_kissingen_1928": ("bad_kissingen_1928_chess_tournament", 0),
    "carlsbad_1929": ("carlsbad_1929_chess_tournament", 0),
    "bled_1931": ("bled_1931_chess_tournament", 0),
    "nottingham_1936": ("nottingham_1936_chess_tournament", 0),
    "avro_1938": ("avro_1938_chess_tournament", 1),
    # проверенные этой ночью — ещё раз, уже с именами
    "berlin_1881": ("berlin_1881_chess_tournament", 0),
    "new_york_1889": ("new_york_1889_chess_tournament", 5),
    "berlin_1897": ("berlin_1897_chess_tournament", 0),
    "kyiv_1903": ("kiev_1903_chess_tournament", 0),
    "cambridge_springs_1904": ("1904_cambridge_springs_international_chess_congress", 0),
    "monte_carlo_1904": ("monte_carlo_chess_tournament", 3),
    "ostend_1907": ("ostend_1907_chess_tournament", 0),
    "prague_1908": ("prague_1908_chess_tournament", 0),
    "vienna_1908": ("vienna_1908_chess_tournament", 0),
    "hamburg_1910": ("hamburg_1910_chess_tournament", 0),
    "san_sebastian_1912": ("san_sebasti_n_chess_tournament", 1),
    "moravska_ostrava_1923": ("moravsk_ostrava_1923_chess_tournament", 0),
    "san_remo_1930": ("san_remo_1930_chess_tournament", 0),
}
BOT_NAMES = {key: str(meta.get("pgn_name", key)) for key, meta in BOT_METADATA.items()}
# Один и тот же человек, записанный в источнике иначе, чем у нас (id -> часть имени в источнике).
KNOWN_SPELLINGS = {
    "steinitz": "wilhelm steinitz", "janowski": "dawid janowski", "salwe": "gersz salwe",
    "dus_chotimirsky": "duz-khotimirsky", "dandre": "andre", "moreau": "colonel moreau",
    "ilyin_zhenevsky": "ilyin-genevsky", "bohatyrchuk": "bogatyrchuk", "romih": "massimiliano romi",
    "stoltz": "gosta stoltz",
}
# Опечатки самих источников: (турнир, участник) — очки или ячейки строки в таблице источника не сходятся.
# Карлсбад 1911: у Видмара напечатано 15½, по его строке и общему итогу (325) — 15, в реестре 15.
# Вена 1898: ячейки строк Шифферса и Шовальтера дают на пол-очка меньше напечатанного итога; итоги верны.
KNOWN_SOURCE_TYPOS = {("carlsbad_1911", "vidmar"), ("vienna_1898", "schiffers"), ("vienna_1898", "showalter")}


def plain(text: str) -> str:
    text = text.replace("ø", "o").replace("ł", "l").replace("ß", "ss").replace("Ł", "L")
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def number(cell: str) -> float | None:
    cell = re.sub(r"'''|<[^>]+>|&nbsp;", " ", cell).strip()
    cell = re.sub(r"\{\{frac\|(\d)\|(\d)\}\}", lambda m: f" {int(m.group(1)) / int(m.group(2))}", cell)
    cell = cell.replace("{{frac|2}}", "½").replace("½", ".5").replace(" ", "")
    if cell.startswith(".5"):
        cell = "0" + cell
    match = re.fullmatch(r"(\d+)(\.\d+)?", cell)
    return float(match.group(0)) if match else None


def result_points(cell: str) -> float | None:
    cell = cell.replace("{{frac|1|2}}", "½").replace("{{frac|2}}", "½")
    cell = re.sub(r"'''|<[^>]+>|\{\{[^}]*\}\}|style=[^|]*\|", "", cell).strip()
    if cell == "" or re.fullmatch(r"[xX*\-–\s]+", cell):
        return 0.0
    if not re.fullmatch(r"[01½\-–+=\s]+", cell):
        return None
    return cell.count("1") + cell.count("+") + 0.5 * cell.count("½")


def rows_of(slug: str, index: int) -> list[tuple[str, float | None, float | None]]:
    text = (HERE / ".cache" / f"{slug}.txt").read_text(encoding="utf-8")
    table = re.findall(r"\{\|.*?\n\|\}", text, flags=re.S)[index]
    out = []
    for row in table.split("\n|-")[1:]:
        row = row.replace("\n||", "||").replace("|||", "||")  # перенос перед разделителем и лишняя черта
        cells = [c.strip() for c in re.split(r"\|\||\n\|", "\n" + row.strip().lstrip("|")) if c.strip() != ""]
        def letters(cell: str) -> str:
            return re.sub(r'(?:style|rowspan|colspan|align|bgcolor)\s*=\s*(?:"[^"]*"|[^|\s]+)\s*\|?', "", cell)

        named = next((i for i, c in enumerate(cells) if re.search(r"[A-Za-z]{4,}", letters(c))), None)
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
        name = plain(re.sub(r"\s*\(.*?\)", "", re.sub(r"align=\s*\w+\s*\||style=[^|]*\|", "", name))).strip()
        rest = cells[named + 1:]
        while rest and number(rest[0]) is None and result_points(rest[0]) is None:
            rest = rest[1:]
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


def our_name(player_id: str) -> str:
    guest = GUESTS_BY_ID.get(player_id)
    return guest.pgn_name if guest else BOT_NAMES.get(player_id, player_id)


def same_person(source: str, ours: str) -> bool:
    """Source «first [middle] surname», ours «Surname, First [Middle]»: surname and the first name must agree."""
    surname, _, given = ours.partition(", ")
    words = plain(source).replace(".", " ").replace("-", " ").split()
    sur = plain(surname).replace("-", " ").split()
    # фамилия: последнее слово нашей фамилии есть в источнике (с учётом ue/oe/ae и вариантов записи)
    variants = {sur[-1], sur[-1].replace("ue", "u").replace("oe", "o").replace("ae", "a")}
    if not any(v in words or any(w.startswith(v[:5]) and len(v) >= 5 for w in words) for v in variants):
        return False
    first = plain(given).replace(".", " ").split()
    if not first or not words:
        return True
    # имя: первое слово имени совпадает с началом имени в источнике (инициалы допускаются)
    return any(w == first[0] or (len(w) == 1 and first[0].startswith(w)) or (len(first[0]) == 1 and w.startswith(first[0]))
               or w[:4] == first[0][:4] for w in words[:-1]) or len(words) == 1


only = set(sys.argv[1:])
bad = 0
for event in EVENTS:
    if event.key not in SOURCES or (only and event.key not in only):
        continue
    slug, index = SOURCES[event.key]
    try:
        source = [(n, t, c) for n, t, c in rows_of(slug, index) if t is not None]
    except Exception as exc:  # noqa: BLE001
        print(f"{event.key:24} PARSE ERROR {exc}")
        bad += 1
        continue
    if event.key == "hamburg_1910":
        source = [row for row in source if "jacob" not in row[0]]
    field = event.field
    status = []
    if len(source) != len(field):
        status.append(f"rows {len(source)} vs {len(field)}")
    for (name, total, cross), entry in zip(source, field, strict=False):
        ours = our_name(entry.id)
        if not same_person(name, ours) and KNOWN_SPELLINGS.get(entry.id, "\0") not in name:
            status.append(f"NAME {entry.id} «{ours}» vs «{name}»")
        typo = (event.key, entry.id) in KNOWN_SOURCE_TYPOS
        if entry.score is not None and total != float(entry.score) and not typo:
            status.append(f"SCORE {entry.id}: {entry.score} vs {total}")
        if cross is not None and total is not None and abs(cross - total) > 1e-9 and not typo:
            status.append(f"row {entry.id}: cells {cross} vs total {total}")
    print(f"{event.key:24} {len(field):2} players | {'OK' if not status else ' ; '.join(status)[:900]}")
    bad += bool(status)
print("FAILED:", bad) if bad else print("ALL OK")
