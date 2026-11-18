"""Fetches wikitext of Russian Wikipedia pages into wiki/<name>.txt: python wiki_fetch_ru.py <outdir> name=Title ..."""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "chess-history-table-check/1.0 (batch verification of historical tournament tables)"}
API = "https://ru.wikipedia.org/w/api.php?"


def get(params: dict) -> dict:
    """Скачивает и кэширует HTML-страницу статьи русской Википедии."""
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
for pair in sys.argv[2:]:
    name, _, title = pair.partition("=")
    target = out / f"{name}.txt"
    if target.exists():
        print("cached", name)
        continue
    data = get({"action": "parse", "page": title, "prop": "wikitext", "redirects": 1})
    text = data.get("parse", {}).get("wikitext", {}).get("*")
    if text is None:
        print("MISSING", name, data.get("error", "")[:80])
    else:
        target.write_text(text, encoding="utf-8")
        print("ok", name, len(text), "chars,", text.count("{|"), "tables")
    time.sleep(4)
