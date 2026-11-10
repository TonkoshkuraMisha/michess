# --- FILE: scripts/download_champions.py ---

import shutil
import subprocess
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_CHAMPIONS_DIR = PROJECT_ROOT / "frontend" / "public" / "assets" / "champions"
SRC_CHAMPIONS_DIR = PROJECT_ROOT / "frontend" / "src" / "assets" / "champions"

PUBLIC_CHAMPIONS_DIR.mkdir(parents=True, exist_ok=True)
SRC_CHAMPIONS_DIR.mkdir(parents=True, exist_ok=True)

champions = {
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


def sync_historical_portraits() -> None:
    """Синхронизирует портреты между frontend/src/assets/champions и frontend/public/assets/champions."""
    copied = 0
    for src_img in SRC_CHAMPIONS_DIR.glob("*.*"):
        if src_img.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            dst = PUBLIC_CHAMPIONS_DIR / src_img.name
            if not dst.exists() or src_img.stat().st_size != dst.stat().st_size:
                shutil.copy2(src_img, dst)
                copied += 1

    for pub_img in PUBLIC_CHAMPIONS_DIR.glob("*.*"):
        if pub_img.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            dst = SRC_CHAMPIONS_DIR / pub_img.name
            if not dst.exists():
                shutil.copy2(pub_img, dst)
                copied += 1

    print(f"[+] Синхронизировано портретов между src/assets и public/assets: {copied}")


def main() -> None:
    sync_historical_portraits()

    api_url = "https://ru.wikipedia.org/w/api.php"
    headers = {"User-Agent": "MiChess/1.0 (chess application; python-requests)"}
    session = requests.Session()
    session.headers.update(headers)

    print("Проверка и докачка портретов чемпионов...\n")

    for champ_id, wiki_title in champions.items():
        save_path = PUBLIC_CHAMPIONS_DIR / f"{champ_id}.jpg"
        if save_path.exists() and save_path.stat().st_size > 0:
            print(f"[~] {champ_id}.jpg уже существует, пропускаем.")
            continue

        params = {
            "action": "query",
            "titles": wiki_title,
            "prop": "pageimages",
            "piprop": "thumbnail",
            "pithumbsize": "500",
            "format": "json",
            "formatversion": "2",
        }

        for _attempt in range(3):
            try:
                response = session.get(api_url, params=params, timeout=15)
                if response.status_code == 429:
                    time.sleep(15)
                    continue
                if response.status_code != 200:
                    break

                pages = response.json().get("query", {}).get("pages", [])
                if not pages or not pages[0].get("thumbnail"):
                    break

                img_url = pages[0]["thumbnail"]["source"].split("?")[0]
                cmd = [
                    "curl", "-sS", "-L",
                    "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
                    "-e", "https://ru.wikipedia.org/",
                    "--fail", img_url, "-o", str(save_path),
                ]
                result = subprocess.run(cmd, capture_output=True)
                if result.returncode == 0 and save_path.exists() and save_path.stat().st_size > 0:
                    print(f"[+] {champ_id}.jpg успешно скачан!")
                    break
            except Exception as exc:
                print(f"[-] Ошибка для {champ_id}: {exc}")
                break
        time.sleep(2)

    sync_historical_portraits()
    print("\nГотово! Все портреты синхронизированы.")


if __name__ == "__main__":
    main()
