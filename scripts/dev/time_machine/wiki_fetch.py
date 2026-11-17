"""Fetches the wikitext of tournament pages from English Wikipedia into scratchpad/wiki/<slug>.txt.

    python wiki_fetch.py <outdir> "Title one" "Title two" ...

A title that does not exist is resolved through search (first hit is printed, not fetched silently).
"""
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "chess-history-table-check/1.0 (batch verification of historical tournament tables)"}
API = "https://en.wikipedia.org/w/api.php?"


def get(params: dict) -> dict:
    url = API + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                return {"error": str(exc)}
            time.sleep(6 * (attempt + 1))
    return {}


out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for title in sys.argv[2:]:
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    target = out / f"{slug}.txt"
    if target.exists():
        print("cached", title)
        continue
    data = get({"action": "parse", "page": title, "prop": "wikitext", "redirects": 1})
    text = data.get("parse", {}).get("wikitext", {}).get("*")
    if text is None:
        found = get({"action": "query", "list": "search", "srsearch": title, "srlimit": 4})
        hits = [h["title"] for h in found.get("query", {}).get("search", [])]
        print("MISSING", title, "->", hits)
    else:
        target.write_text(text, encoding="utf-8")
        tables = text.count("{|")
        print("ok", data["parse"]["title"], len(text), "chars,", tables, "tables")
    time.sleep(4)
