# --- FILE: scripts/chessgames_downloader.py ---

import argparse
import asyncio
import re
import sys
from pathlib import Path

import httpx

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.build_opening_books import build_book_for_bot  # noqa: E402

BASE_URL = "https://www.chessgames.com"
DATA_PGNS_DIR = PROJECT_ROOT / "data" / "pgns"

PLAYERS_CONFIG = {
    "staunton": {"pid": 19077, "pages": 25, "name": "Howard Staunton"},
    "anderssen": {"pid": 10342, "pages": 34, "name": "Adolf Anderssen"},
    "morphy": {"pid": 16002, "pages": 19, "name": "Paul Morphy"},
    "paulsen": {"pid": 10343, "pages": 22, "name": "Louis Paulsen"},
    "zukertort": {"pid": 10427, "pages": 25, "name": "Johannes Zukertort"},
}

TABLE_GAME_REGEX = re.compile(
    r'\d+\.(?:&nbsp;|\xa0|\s)*<a[^>]*href="/perl/chessgame\?gid=(\d+)"',
    re.IGNORECASE,
)
PAGINATION_INFO_REGEX = re.compile(
    r"page\s+\d+\s+of\s+(\d+)\s*;\s*games\s+\d+-\d+\s+of\s+(\d+)",
    re.IGNORECASE,
)


async def fetch_gids_from_page(
        client: httpx.AsyncClient, pid: int, page: int
) -> tuple[list[str], int | None, int | None]:
    url = (
        f"{BASE_URL}/perl/chessplayer?pid={pid}"
        if page == 1
        else f"{BASE_URL}/perl/chess.pl?page={page}&pid={pid}"
    )

    for attempt in range(1, 7):
        try:
            response = await client.get(url)
            if response.status_code in (429, 403, 503):
                wait_sec = 10 * attempt
                print(f"[!] Лимит ({response.status_code}) на стр. {page}, пауза {wait_sec} сек...")
                await asyncio.sleep(wait_sec)
                continue

            response.raise_for_status()
            gids = list(dict.fromkeys(TABLE_GAME_REGEX.findall(response.text)))

            detected_pages, detected_total = None, None
            match = PAGINATION_INFO_REGEX.search(response.text)
            if match:
                detected_pages, detected_total = int(match.group(1)), int(match.group(2))

            if not gids:
                wait_sec = 8 * attempt
                print(f"[!] Стр. {page} вернула 0 партий (попытка {attempt}/6), пауза {wait_sec} сек...")
                await asyncio.sleep(wait_sec)
                continue

            return gids, detected_pages, detected_total
        except httpx.HTTPError as exc:
            wait_sec = 4 * attempt
            print(f"[!] Ошибка сети на стр. {page} (попытка {attempt}): {exc}")
            await asyncio.sleep(wait_sec)

    return [], None, None


async def download_pgn(
        client: httpx.AsyncClient,
        player_key: str,
        player_dir: Path,
        gid: str,
        semaphore: asyncio.Semaphore,
        index: int,
        total: int,
) -> tuple[int, str, str]:
    file_path = player_dir / f"{index:03d}_{player_key}_{gid}.pgn"
    if file_path.exists():
        cached = file_path.read_text(encoding="utf-8", errors="ignore").strip()
        if "[Event " in cached:
            return index, gid, cached

    url = f"{BASE_URL}/njs/api/game/downloadPGN/{gid}"
    async with semaphore:
        for attempt in range(1, 7):
            try:
                resp = await client.get(url)
                text = resp.text.strip()
                if resp.status_code == 200 and "[Event " in text:
                    file_path.write_text(text + "\n", encoding="utf-8")
                    if index % 25 == 0 or index == total:
                        print(f"[{index:03d}/{total}] Скачано (gid={gid})...")
                    await asyncio.sleep(0.35)
                    return index, gid, text
                await asyncio.sleep(15 * attempt)
            except httpx.RequestError:
                await asyncio.sleep(3 * attempt)

    return index, gid, ""


async def download_player_games(player_key: str) -> None:
    cfg = PLAYERS_CONFIG[player_key]
    pid = cfg["pid"]
    total_pages = cfg["pages"]
    player_dir = DATA_PGNS_DIR / f"{player_key}_pgns"
    player_dir.mkdir(parents=True, exist_ok=True)
    combined_file = DATA_PGNS_DIR / f"{player_key}_all_games.pgn"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36",
        "Referer": f"{BASE_URL}/perl/chessplayer?pid={pid}",
    }
    semaphore = asyncio.Semaphore(3)

    async with httpx.AsyncClient(headers=headers, timeout=25.0, follow_redirects=True) as client:
        print(f"=== Скачивание базы: {cfg['name']} (pid={pid}) ===")
        all_gids: list[str] = []
        page = 1
        while page <= total_pages:
            gids, det_pages, det_total = await fetch_gids_from_page(client, pid, page)
            if det_pages:
                total_pages = det_pages
            for gid in gids:
                if gid not in all_gids:
                    all_gids.append(gid)
            total_info = f"/{det_total}" if det_total else ""
            print(
                f"[Страница {page:02d}/{total_pages:02d}] Найдено: {len(gids)} | Всего ID: {len(all_gids)}{total_info}")
            page += 1
            await asyncio.sleep(0.35)

        if not all_gids:
            print(f"[-] Партии для {player_key} не найдены.")
            return

        tasks = [
            download_pgn(client, player_key, player_dir, gid, semaphore, idx, len(all_gids))
            for idx, gid in enumerate(all_gids, start=1)
        ]
        results = await asyncio.gather(*tasks)
        results.sort(key=lambda x: x[0])
        valid_pgns = [pgn for _, _, pgn in results if pgn]

        combined_file.write_text("\n\n".join(valid_pgns) + "\n", encoding="utf-8")
        print(f"[+] Сохранено {len(valid_pgns)} партий в {combined_file}")

    build_book_for_bot(player_key)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Единый загрузчик PGN исторических чемпионов с Chessgames.")
    parser.add_argument(
        "player",
        nargs="?",
        default="zukertort",
        choices=list(PLAYERS_CONFIG.keys()),
        help="Ключ шахматиста (по умолчанию: zukertort)",
    )
    parser.add_argument("--all", action="store_true", help="Скачать партии всех шахматистов")
    args = parser.parse_args()

    if args.all:
        for key in PLAYERS_CONFIG:
            await download_player_games(key)
    else:
        await download_player_games(args.player)


if __name__ == "__main__":
    asyncio.run(main())
