"""Applies a content batch (guests + events) to the server registries and the three client catalogs.

Run from the repo root: python apply_batch.py batchN.json
"""
import json
import pathlib
import sys
import textwrap

batch = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
LANGS = ("en", "uk", "ru")


def q(text: str) -> str:
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def number(value) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


# --- server: guests ------------------------------------------------------------------------------------------------
path = pathlib.Path("src/services/bots/guests.py")
s = path.read_text(encoding="utf-8")
anchor = ")\nGUESTS_BY_ID = "
assert s.count(anchor) == 1
lines = []
if batch["guests"]:
    title = batch["guests_header"]
    lines.append(f"\n    # --- {title} " + "-" * max(3, 104 - len(title)))
for g in batch["guests"]:
    assert f'_guest("{g["id"]}"' not in s, g["id"]
    assert len(g["pgn"]) <= 30 and g["pgn"].isascii(), g["pgn"]
    if g.get("note"):
        lines.append(f"    # {g['note']}")
    style = ", ".join(f"{k}={json.dumps(v)}" for k, v in g["style"].items())
    era = f'"{g["era"]}"' if g["era"] else "None"
    call = f'    _guest("{g["id"]}", "{g["pgn"]}", {era}, {g["rating"]}, {style}),'
    if len(call) > 120:
        head = f'    _guest("{g["id"]}", "{g["pgn"]}", {era}, {g["rating"]},'
        call = head + "\n           " + style + "),"
    lines.append(call)
s = s.replace(anchor, "\n".join(lines) + "\n" + anchor if lines else anchor)
path.write_text(s, encoding="utf-8", newline="\n")

# --- server: events ------------------------------------------------------------------------------------------------
path = pathlib.Path("src/services/time_machine.py")
s = path.read_text(encoding="utf-8")
if "_EVENTS: tuple[Event, ...] = (" not in s:
    old = "EVENTS: tuple[Event, ...] = (\n"
    assert s.count(old) == 1
    s = s.replace(old, "_EVENTS: tuple[Event, ...] = (\n")
    old = ")\nEVENTS_BY_KEY = {event.key: event for event in EVENTS}\n"
    assert s.count(old) == 1
    s = s.replace(old, ")\n# Лента — по годам; турниры одного года — по ключу.\n"
                       "EVENTS: tuple[Event, ...] = tuple(sorted(_EVENTS, key=lambda event: (event.year, event.key)))\n"
                       "EVENTS_BY_KEY = {event.key: event for event in EVENTS}\n")
anchor = ")\n# Лента — по годам; турниры одного года — по ключу.\n"
assert s.count(anchor) == 1
lines = []
for e in batch["events"]:
    assert f'Event("{e["key"]}"' not in s, e["key"]
    # Пояснение к турниру — комментарий над записью; длинное переносится, чтобы пройти проверку длины строки.
    lines.extend(textwrap.wrap(e["note"], width=112, initial_indent="    # ", subsequent_indent="    # "))
    cycles = f", cycles={e['cycles']}" if e.get("cycles", 1) > 1 else ""
    if e["format"] == "round_robin":
        rows, row = [], "       "
        for player, score in e["table"]:
            cell = f' ("{player}", {number(score)}),'
            if len(row) + len(cell) > 118:
                rows.append(row)
                row = "       "
            row += cell
        rows.append(row)
        lines.append(f'    Event("{e["key"]}", {e["year"]}, "round_robin", _table(')
        lines.extend(rows)
        partial = ", partial=True" if e.get("partial") else ""
        lines.append(f"    ){cycles}{partial}),")
    else:
        rows, row = [], "       "
        for player, place in e["field"]:
            cell = f' Entry("{player}", {place if place is not None else "None"}),'
            if len(row) + len(cell) > 118:
                rows.append(row)
                row = "       "
            row += cell
        rows.append(row)
        lines.append(f'    Event("{e["key"]}", {e["year"]}, "knockout", (')
        lines.extend(rows)
        lines.append("    )),")
s = s.replace(anchor, "\n".join(lines) + "\n" + anchor)
path.write_text(s, encoding="utf-8", newline="\n")

# --- client catalogs -----------------------------------------------------------------------------------------------
for lang in LANGS:
    path = pathlib.Path(f"frontend/src/i18n/messages/{lang}.ts")
    s = path.read_text(encoding="utf-8")
    # мастера — в конец блока bots.guests
    start = s.index("        guests: {\n")
    end = s.index("\n        },\n", start)
    guests = "".join(
        f"\n            {g['id']}: {{name: {q(g[lang][0])}, shortName: {q(g[lang][1])}, about: {q(g[lang][2])}}},"
        for g in batch["guests"])
    s = s[:end] + guests + s[end:]
    # события — в конец блока timeMachine.events
    start = s.index("    timeMachine: {\n")
    events_start = s.index("        events: {\n", start)
    end = s.index("\n        },\n    },\n", events_start)
    events = ""
    for e in batch["events"]:
        events += f"\n            {e['key']}: {{"
        for part in ("title", "place", "story", "real"):
            events += f"\n                {part}: {q(e[lang][part])},"
        events += "\n            },"
    s = s[:end] + events + s[end:]
    path.write_text(s, encoding="utf-8", newline="\n")

print("guests", len(batch["guests"]), "events", len(batch["events"]))
