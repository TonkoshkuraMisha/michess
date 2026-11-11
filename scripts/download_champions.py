# --- FILE: scripts/download_champions.py ---
"""
Портреты шахматистов из Викисклада — только со свободной лицензией и с записью об авторе.

Для каждого игрока берётся заглавное изображение его статьи в русской Википедии, но лишь если
файл лежит на Викискладе под лицензией, разрешающей использование в любом проекте (общественное
достояние, CC0, CC BY, CC BY-SA). Файлы, загруженные в Википедию локально («добросовестное
использование»), и лицензии с условиями NC/ND пропускаются: у такого игрока портрета нет, а
интерфейс показывает инициалы.

Рядом с портретами пишется манифест frontend/src/config/portraitCredits.json: файл, автор,
лицензия, ссылка на источник. Из него строятся страница «О проекте» и раздел ATTRIBUTION.md;
tests/test_assets_licensing.py проверяет, что у каждого портрета в репозитории есть запись.

Запуск:  python scripts/download_champions.py            # докачать недостающее
         python scripts/download_champions.py --force    # перекачать всё заново
"""

import json
import re
import shutil
import sys
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_CHAMPIONS_DIR = PROJECT_ROOT / "frontend" / "public" / "assets" / "champions"
SRC_CHAMPIONS_DIR = PROJECT_ROOT / "frontend" / "src" / "assets" / "champions"
CREDITS_PATH = PROJECT_ROOT / "frontend" / "src" / "config" / "portraitCredits.json"

WIKIPEDIA_API = "https://ru.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
THUMB_WIDTH = 500

# id файла портрета -> название статьи в русской Википедии
PLAYERS: dict[str, str] = {
    "philidor": "Филидор, Франсуа-Андре Даникан",
    "labourdonnais": "Лабурдонне, Луи Шарль де",
    "staunton": "Стаунтон, Говард",
    "anderssen": "Андерсен, Адольф",
    "morphy": "Морфи, Пол",
    "paulsen": "Паульсен, Луи",
    "zukertort": "Цукерторт, Иоганн",
    "Steinitz": "Стейниц, Вильгельм",
    "Lasker": "Ласкер, Эмануил",
    "Rubinstein": "Рубинштейн, Акиба Кивелевич",
    "Capablanca": "Капабланка, Хосе Рауль",
    "Alekhine": "Алехин, Александр Александрович",
    "Euwe": "Эйве, Макс",
    "Keres": "Керес, Пауль Петрович",
    "Botvinnik": "Ботвинник, Михаил Моисеевич",
    "Geller": "Геллер, Ефим Петрович",
    "Korchnoi": "Корчной, Виктор Львович",
    "Smyslov": "Смыслов, Василий Васильевич",
    "Tal": "Таль, Михаил Нехемьевич",
    "Petrosian": "Петросян, Тигран Вартанович",
    "Spassky": "Спасский, Борис Васильевич",
    "Fischer": "Фишер, Роберт Джеймс",
    "Karpov": "Анатолий Карпов",
    "Kasparov": "Каспаров, Гарри Кимович",
    "Kramnik": "Крамник, Владимир Борисович",
    "Anand": "Ананд, Вишванатан",
    "Carlsen": "Карлсен, Магнус",
    "Ding": "Дин Лижэнь",
}

_TAG_RE = re.compile(r"<[^>]+>")


def is_free_license(short_name: str) -> bool:
    """Лицензия разрешает использование в любом проекте, включая коммерческий, и изменение."""
    name = short_name.strip().lower()
    tokens = set(re.split(r"[\s-]+", name))
    if not name or tokens & {"nc", "nd"}:
        return False
    return name.startswith(("public domain", "pd", "cc0", "cc by", "cc-by", "no restrictions"))


def _clean(html_text: str) -> str:
    text = _TAG_RE.sub("", html_text or "").replace("&amp;", "&").replace("\n", " ").strip()
    # Викисклад дублирует «Unknown author» в видимой и скрытой разметке.
    text = text.replace("Unknown authorUnknown author", "Unknown author").replace("AnonymousUnknown author", "Unknown author")
    return re.sub(r"\s+", " ", text).rstrip("] ").strip() or "Unknown author"


def _get_json(session: requests.Session, url: str, params: dict) -> dict:
    last_status = 0
    for _attempt in range(5):
        response = session.get(url, params=params, timeout=30)
        last_status = response.status_code
        if response.status_code == 200:
            return response.json()
        time.sleep(10)  # 429 — подождать и повторить
    raise RuntimeError(f"{url}: HTTP {last_status}")


def find_lead_images(session: requests.Session) -> dict[str, dict]:
    """id игрока -> {file, thumb} заглавного изображения статьи (один запрос на всех)."""
    data = _get_json(session, WIKIPEDIA_API, {
        "action": "query", "titles": "|".join(PLAYERS.values()), "prop": "pageimages",
        "piprop": "name|thumbnail", "pithumbsize": str(THUMB_WIDTH), "pilimit": "50",
        "redirects": "1", "format": "json", "formatversion": "2",
    })["query"]
    renamed = {item["from"]: item["to"] for item in data.get("normalized", [])}
    renamed.update({item["from"]: item["to"] for item in data.get("redirects", [])})
    pages = {page["title"]: page for page in data["pages"]}

    found: dict[str, dict] = {}
    for player_id, title in PLAYERS.items():
        resolved = renamed.get(title, title)
        resolved = renamed.get(resolved, resolved)
        page = pages.get(resolved, {})
        if page.get("pageimage") and page.get("thumbnail"):
            found[player_id] = {"file": page["pageimage"], "thumb": page["thumbnail"]["source"]}
    return found


def fetch_commons_metadata(session: requests.Session, file_names: list[str]) -> dict[str, dict]:
    """Имя файла -> {license, license_url, author, source_url}. Файлов не с Викисклада в ответе нет."""
    data = _get_json(session, COMMONS_API, {
        "action": "query", "titles": "|".join(f"File:{name}" for name in file_names), "prop": "imageinfo",
        "iiprop": "extmetadata|url", "format": "json", "formatversion": "2",
    })["query"]
    original = {item["to"]: item["from"] for item in data.get("normalized", [])}

    metadata: dict[str, dict] = {}
    for page in data["pages"]:
        if "imageinfo" not in page:
            continue
        info = page["imageinfo"][0]
        ext = info.get("extmetadata", {})
        name = original.get(page["title"], page["title"]).removeprefix("File:")
        metadata[name] = {
            "license": _clean(ext.get("LicenseShortName", {}).get("value", "")),
            "license_url": ext.get("LicenseUrl", {}).get("value", ""),
            "author": _clean(ext.get("Artist", {}).get("value", "")),
            "source_url": info.get("descriptionurl", ""),
        }
    return metadata


def main(force: bool = False) -> int:
    PUBLIC_CHAMPIONS_DIR.mkdir(parents=True, exist_ok=True)
    SRC_CHAMPIONS_DIR.mkdir(parents=True, exist_ok=True)
    credits: dict[str, dict] = {}
    if CREDITS_PATH.exists() and not force:
        credits = json.loads(CREDITS_PATH.read_text(encoding="utf-8"))

    session = requests.Session()
    session.headers["User-Agent"] = "portrait-downloader/2.0 (python-requests)"

    images = find_lead_images(session)
    time.sleep(2)
    metadata = fetch_commons_metadata(session, [item["file"] for item in images.values()])

    for player_id in PLAYERS:
        target = PUBLIC_CHAMPIONS_DIR / f"{player_id}.jpg"
        if player_id in credits and target.exists() and not force:
            print(f"[~] {player_id}: уже есть")
            continue

        image = images.get(player_id)
        meta = metadata.get(image["file"]) if image else None
        if not image or not meta or not is_free_license(meta["license"]):
            reason = "нет изображения" if not image else "не на Викискладе" if not meta else meta["license"]
            print(f"[-] {player_id}: пропущен ({reason}) — в интерфейсе будут инициалы")
            target.unlink(missing_ok=True)
            credits.pop(player_id, None)
            continue

        time.sleep(1.5)
        response = session.get(image["thumb"], timeout=30)
        if response.status_code != 200 or not response.content:
            print(f"[!] {player_id}: не скачался (HTTP {response.status_code})")
            continue
        target.write_bytes(response.content)
        credits[player_id] = {"file": image["file"], **meta}
        print(f"[+] {player_id}: {meta['license']} — {meta['author']}")

    for extra in PUBLIC_CHAMPIONS_DIR.glob("*.jpg"):
        if extra.stem not in credits:
            print(f"[!] {extra.name}: нет записи об источнике — удалён")
            extra.unlink()

    # Портреты ботов импортируются сборщиком из src/assets, остальные раздаются из public.
    shutil.rmtree(SRC_CHAMPIONS_DIR)
    SRC_CHAMPIONS_DIR.mkdir(parents=True)
    for portrait in PUBLIC_CHAMPIONS_DIR.glob("*.jpg"):
        shutil.copy2(portrait, SRC_CHAMPIONS_DIR / portrait.name)

    ordered = {player_id: credits[player_id] for player_id in PLAYERS if player_id in credits}
    CREDITS_PATH.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nГотово: {len(ordered)} из {len(PLAYERS)} портретов, манифест — {CREDITS_PATH.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(force="--force" in sys.argv))
