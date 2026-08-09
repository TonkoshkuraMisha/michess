import os
import time
import requests
import subprocess

champions = {
    'Steinitz': 'Стейниц, Вильгельм',
    'Lasker': 'Ласкер, Эмануил',
    'Rubinstein': 'Рубинштейн, Акиба Кивелевич',
    'Capablanca': 'Капабланка, Хосе Рауль',
    'Alekhine': 'Алехин, Александр Александрович',
    'Euwe': 'Эйве, Макс',
    'Keres': 'Керес, Пауль Петрович',
    'Botvinnik': 'Ботвинник, Михаил Моисеевич',
    'Geller': 'Геллер, Ефим Петрович',
    'Korchnoi': 'Корчной, Виктор Львович',
    'Smyslov': 'Смыслов, Василий Васильевич',
    'Tal': 'Таль, Михаил Нехемьевич',
    'Petrosian': 'Петросян, Тигран Вартанович',
    'Spassky': 'Спасский, Борис Васильевич',
    'Fischer': 'Фишер, Роберт Джеймс',
    'Karpov': 'Карпов, Анатолий Евгеньевич',
    'Kasparov': 'Каспаров, Гарри Кимович',
    'Kramnik': 'Крамник, Владимир Борисович',
    'Anand': 'Ананд, Вишванатан',
    'Carlsen': 'Карлсен, Магнус',
    'Ding': 'Дин Лижэнь'
}

save_dir = os.path.join("frontend", "public", "assets", "champions")
os.makedirs(save_dir, exist_ok=True)

API_URL = "https://ru.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "MiChess/1.0 (chess application; python-requests)"}

session = requests.Session()
session.headers.update(HEADERS)

print("Докачиваем оставшиеся фотографии (с защитой от лимитов)...\n")

for champ_id, wiki_title in champions.items():
    save_path = os.path.abspath(os.path.join(save_dir, f"{champ_id}.jpg"))

    # ПРОПУСКАЕМ ТО, ЧТО УЖЕ СКАЧАЛОСЬ УСПЕШНО
    if os.path.exists(save_path) and os.path.getsize(save_path) > 0:
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

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = session.get(API_URL, params=params, timeout=15)

            # Если словили лимит от API
            if response.status_code == 429:
                print(f"[*] API просит подождать. Пауза 15 секунд... (попытка {attempt + 1})")
                time.sleep(15)
                continue

            if response.status_code != 200:
                print(f"[-] API error: {response.text[:100]}")
                break

            data = response.json()
            pages = data.get("query", {}).get("pages", [])

            if not pages:
                print(f"[-] Страница не найдена: {wiki_title}")
                break

            thumbnail = pages[0].get("thumbnail")
            if not thumbnail:
                print(f"[-] Фото не найдено в статье: {wiki_title}")
                break

            img_url = thumbnail.get("source").split("?")[0]

            cmd = [
                "curl", "-sS", "-L",
                "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
                "-e", "https://ru.wikipedia.org/",
                "--fail", img_url, "-o", save_path
            ]

            result = subprocess.run(cmd, capture_output=True)

            if result.returncode == 0 and os.path.exists(save_path) and os.path.getsize(save_path) > 0:
                print(f"[+] {champ_id}.jpg успешно скачан!")
                break
            else:
                error = result.stderr.decode("utf-8", errors="ignore")
                # Если словили лимит от сервера картинок
                if "429" in error:
                    print(f"[*] Сервер картинок просит подождать. Пауза 15 секунд... (попытка {attempt + 1})")
                    time.sleep(15)
                    continue
                else:
                    print(f"[-] Ошибка curl для {champ_id}: {error}")
                    break

        except Exception as e:
            print(f"[-] Ошибка для {champ_id}: {e}")
            break

    # Большая пауза после каждой попытки скачать (чтобы не злить сервера)
    time.sleep(5)

print("\nГотово! Все фото загружены.")