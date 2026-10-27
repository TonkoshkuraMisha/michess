import requests
from bs4 import BeautifulSoup

url = "https://www.chessgames.com/perl/chess.pl?tid=112874"
headers = {"User-Agent": "Mozilla/5.0"}

response = requests.get(url, headers=headers)
if response.status_code == 200:
    soup = BeautifulSoup(response.text, 'html.parser')

    # Ищем ссылки на индивидуальные партии в таблице
    game_links = []
    for a in soup.find_all('a', href=True):
        if "chess.pl?gid=" in a['href']:
            game_links.append("https://www.chessgames.com/perl/" + a['href'])

    print(f"Найдено партий: {len(set(game_links))}")
