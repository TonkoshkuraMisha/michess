# --- FILE: chessgames_louis_paulsen_games_downloader.py ---

import asyncio
import re
from pathlib import Path
import httpx

PLAYER_ID = 10343  # Точный ID Луи Паульсена на Chessgames.com
TOTAL_PAGES = 22  # 527 партий / 25 на страницу = 22 страницы (последняя неполная)
BASE_URL = "https://www.chessgames.com"

OUTPUT_DIR = Path("paulsen_pgns")
COMBINED_PGN_FILE = Path("louis_paulsen_all_527_games.pgn")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/130.0.0.0 Safari/537.36"
    ),
    "Referer": f"{BASE_URL}/perl/chessplayer?pid={PLAYER_ID}",
}

# Ищет пронумерованные строки партий в таблице
TABLE_GAME_REGEX = re.compile(
    r'\d+\.(?:&nbsp;|\xa0|\s)*<a[^>]*href="/perl/chessgame\?gid=(\d+)"',
    re.IGNORECASE,
)


async def fetch_gids_from_page(client: httpx.AsyncClient, page: int) -> list[str]:
    """Забирает список gid со страницы пагинации через /perl/chess.pl."""
    if page == 1:
        url = f"{BASE_URL}/perl/chessplayer?pid={PLAYER_ID}"
    else:
        url = f"{BASE_URL}/perl/chess.pl?page={page}&pid={PLAYER_ID}"

    for attempt in range(1, 5):
        try:
            response = await client.get(url)
            if response.status_code == 429:
                wait_sec = 10 * attempt
                print(f"[!] Лимит запросов (429) на странице {page}, ждем {wait_sec} сек...")
                await asyncio.sleep(wait_sec)
                continue
            response.raise_for_status()
            gids = TABLE_GAME_REGEX.findall(response.text)
            return list(dict.fromkeys(gids))
        except httpx.HTTPError as exc:
            print(f"[!] Ошибка загрузки страницы {page} (попытка {attempt}): {exc}")
            await asyncio.sleep(3 * attempt)

    return []


async def download_pgn(
        client: httpx.AsyncClient,
        gid: str,
        semaphore: asyncio.Semaphore,
        index: int,
        total: int,
) -> tuple[int, str, str]:
    """Скачивает PGN партии с проверкой на валидность и обработкой 429."""
    file_path = OUTPUT_DIR / f"{index:03d}_paulsen_{gid}.pgn"

    # Если файл уже был успешно скачан ранее — берем с диска
    if file_path.exists():
        cached = file_path.read_text(encoding="utf-8").strip()
        if "[Event " in cached:
            return index, gid, cached

    url = f"{BASE_URL}/njs/api/game/downloadPGN/{gid}"

    async with semaphore:
        attempt = 0
        while attempt < 6:
            attempt += 1
            try:
                resp = await client.get(url)
                text = resp.text.strip()

                # Проверяем, что пришел именно PGN, а не HTML-заглушка лимита
                if resp.status_code == 200 and "[Event " in text:
                    file_path.write_text(text + "\n", encoding="utf-8")
                    if index % 25 == 0 or index == total:
                        print(f"[{index:03d}/{total}] Скачано (последний gid={gid})...")
                    await asyncio.sleep(0.35)
                    return index, gid, text

                if resp.status_code in (429, 403, 503) or "[Event " not in text:
                    wait_sec = 15 * attempt
                    print(
                        f"[!] Сервер ограничил скорость на партии #{index} (gid={gid}, "
                        f"статус {resp.status_code}). Пауза {wait_sec} сек..."
                    )
                    await asyncio.sleep(wait_sec)
                    continue

            except httpx.RequestError as exc:
                print(f"[!] Сбой сети gid={gid} (попытка {attempt}): {exc}")
                await asyncio.sleep(3 * attempt)

    print(f"[ОШИБКА] Не удалось скачать партию #{index} (gid={gid})")
    return index, gid, ""


async def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    # 3 одновременных потока + пауза 0.35с, чтобы не ловить блокировки
    semaphore = asyncio.Semaphore(3)

    async with httpx.AsyncClient(headers=HEADERS, timeout=25.0, follow_redirects=True) as client:
        print("=== Шаг 1: Сбор ID всех 527 партий Луи Паульсена через /perl/chess.pl ===")
        all_gids: list[str] = []

        for page in range(1, TOTAL_PAGES + 1):
            page_gids = await fetch_gids_from_page(client, page)
            before_count = len(all_gids)
            for gid in page_gids:
                if gid not in all_gids:
                    all_gids.append(gid)
            added = len(all_gids) - before_count
            print(
                f"[Страница {page:02d}/{TOTAL_PAGES}] "
                f"На странице: {len(page_gids)} | Новых: +{added} | Всего собрано: {len(all_gids)}"
            )
            await asyncio.sleep(0.3)

        total_games = len(all_gids)
        print(f"\nИтого уникальных партий собрано: {total_games} (ожидалось 527)\n")

        if total_games == 0:
            print("Партии не найдены, прерываем выполнение.")
            return

        print("=== Шаг 2: Скачивание PGN ===")
        tasks = [
            download_pgn(client, gid, semaphore, idx, total_games)
            for idx, gid in enumerate(all_gids, start=1)
        ]
        results = await asyncio.gather(*tasks)

        results.sort(key=lambda x: x[0])
        valid_pgns = [pgn for _, _, pgn in results if pgn]

        COMBINED_PGN_FILE.write_text("\n\n".join(valid_pgns) + "\n", encoding="utf-8")
        print(
            f"\nГотово! Успешно сохранено {len(valid_pgns)} из {total_games} партий "
            f"в файл: {COMBINED_PGN_FILE.resolve()}"
        )


if __name__ == "__main__":
    asyncio.run(main())
