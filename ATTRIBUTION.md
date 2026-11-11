# Чужие работы в проекте: авторы и лицензии

Правило проекта: ассет (набор фигур, портрет, звук, текстура, шрифт, база данных) добавляется только вместе с
записью в этом файле — источник, автор, лицензия. Нет понятной лицензии, разрешающей использование в любом
проекте, — ассет не добавляется. Соответствие этого файла содержимому репозитория проверяет
`tests/test_assets_licensing.py`; тот же список показывается пользователям на странице `/about`.

## Шахматный движок

| Что | Автор | Лицензия | Как используется |
|---|---|---|---|
| [Stockfish](https://github.com/official-stockfish/Stockfish) | The Stockfish developers | GPL-3.0 | Отдельная программа, запускается через `EnginePool`; не изменён. В Docker-образ ставится пакетом Debian `stockfish`; локально — `scripts/setup_stockfish.py` (папка `bin/` в git не входит). |

## Наборы фигур — `frontend/public/assets/pieces/`

Скачиваются `scripts/setup_piece_sets.py` из репозитория [lichess-org/lila](https://github.com/lichess-org/lila);
авторы и лицензии — по его [COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md).

| Папка | Автор | Лицензия |
|---|---|---|
| `merida` | Armando Hernandez Marroquin | GPL-2.0-or-later |
| `cburnett` | Colin M.L. Burnett | GPL-2.0-or-later |
| `chessnut` | Alexis Luengas | Apache-2.0 |
| `fantasy` | Maurizio Monge | MIT |
| `rhosgfx` | RhosGFX | CC0-1.0 |
| `outline` | michess, производная от `merida` (добавлена окантовка) | GPL-2.0-or-later |

Убраны как несвободные: `alpha` (Eric Bentzen, «free for personal non commercial use»), `maestro` (sadsnake1,
CC BY-NC-SA 4.0), а также набор без известного происхождения, лежавший в корне папки и в `classic/`.

## Портреты шахматистов — `frontend/public/assets/champions/`

Скачиваются `scripts/download_champions.py` с Викисклада (уменьшенная копия шириной 500 пикселей) и только под
свободной лицензией; манифест — `frontend/src/config/portraitCredits.json`. Работы под CC BY-SA распространяются
на тех же условиях. Копии семи портретов в `frontend/src/assets/champions/` — те же файлы.

| Файл | Исходный файл на Викискладе | Автор | Лицензия |
|---|---|---|---|
| `philidor.jpg` | [Francois-Andre Danican Philidor.jpg](https://commons.wikimedia.org/wiki/File:Francois-Andre_Danican_Philidor.jpg) | Augustin de Saint-Aubin | Public domain |
| `labourdonnais.jpg` | [Louisdelabourdonnais.jpg](https://commons.wikimedia.org/wiki/File:Louisdelabourdonnais.jpg) | The original uploader was Jaapvanderkooij at Dutch Wikipedia. | Public domain |
| `staunton.jpg` | [Howard-Staunton-ILN.jpeg](https://commons.wikimedia.org/wiki/File:Howard-Staunton-ILN.jpeg) | R. & E. Taylor (Firm) / After Thomas Dewell Scott | Public domain |
| `anderssen.jpg` | [Anderssen, Adolf "-5" - DPLA - 9ca464339f18b3d8be87fccc68c3ee73 (cropped).jpg](https://commons.wikimedia.org/wiki/File:Anderssen,_Adolf_%22-5%22_-_DPLA_-_9ca464339f18b3d8be87fccc68c3ee73_(cropped).jpg) | Unknown author | Public domain |
| `morphy.jpg` | [PaulmorphyHair.jpg](https://commons.wikimedia.org/wiki/File:PaulmorphyHair.jpg) | Unknown author | Public domain |
| `paulsen.jpg` | [LouisPaulsen.jpg](https://commons.wikimedia.org/wiki/File:LouisPaulsen.jpg) | The original uploader was Miastko at German Wikipedia. | Public domain |
| `zukertort.jpg` | [Zukertort, Johannes Hermann "-1" - DPLA - 178f6bd2074f2347becb2e4ebeabd45b (cropped).jpg](https://commons.wikimedia.org/wiki/File:Zukertort,_Johannes_Hermann_%22-1%22_-_DPLA_-_178f6bd2074f2347becb2e4ebeabd45b_(cropped).jpg) | Unknown author | Public domain |
| `Steinitz.jpg` | [Steinitz, William-4 - DPLA - 9eeab9ac335135c24b69ab7e36fc5354 (cropped).jpg](https://commons.wikimedia.org/wiki/File:Steinitz,_William-4_-_DPLA_-_9eeab9ac335135c24b69ab7e36fc5354_(cropped).jpg) | Schumann, Fritz | Public domain |
| `Lasker.jpg` | [Bundesarchiv Bild 102-00457, Emanuel Lasker.jpg](https://commons.wikimedia.org/wiki/File:Bundesarchiv_Bild_102-00457,_Emanuel_Lasker.jpg) | Unknown author | CC BY-SA 3.0 de |
| `Rubinstein.jpg` | [Akiba-Rubinstein.png](https://commons.wikimedia.org/wiki/File:Akiba-Rubinstein.png) | Unknown author | Public domain |
| `Capablanca.jpg` | [José Raúl Capablanca 1931.jpg](https://commons.wikimedia.org/wiki/File:Jos%C3%A9_Ra%C3%BAl_Capablanca_1931.jpg) | Unknown author (Keystone-France) | Public domain |
| `Alekhine.jpg` | [Alexandre Alekhine Color.jpg](https://commons.wikimedia.org/wiki/File:Alexandre_Alekhine_Color.jpg) | Alexandre_Alekhine_01.jpg: George Grantham Bain Collection (Library of Congress) derivative work: JesusAngelRey (talk) | Public domain |
| `Euwe.jpg` | [Max Euwe (1945).jpg](https://commons.wikimedia.org/wiki/File:Max_Euwe_(1945).jpg) | Theo van Haren Noman / Anefo | CC BY-SA 3.0 nl |
| `Keres.jpg` | [Hoogoven Schaaktoernooi Keres, Bestanddeelnr 922-0145.jpg](https://commons.wikimedia.org/wiki/File:Hoogoven_Schaaktoernooi_Keres,_Bestanddeelnr_922-0145.jpg) | Eric Koch for Anefo | CC0 |
| `Botvinnik.jpg` | [Mikhail Botvinnik 1962.jpg](https://commons.wikimedia.org/wiki/File:Mikhail_Botvinnik_1962.jpg) | Harry Pot for Anefo | CC BY-SA 3.0 nl |
| `Geller.jpg` | [Efim Geller 1977b.jpg](https://commons.wikimedia.org/wiki/File:Efim_Geller_1977b.jpg) | Suyk, Koen / Anefo | CC0 |
| `Korchnoi.jpg` | [Max Euwe Schaakvierkamp in Amsterdam Kortsjnoj (close), Bestanddeelnr 933-9735 (cropped).jpg](https://commons.wikimedia.org/wiki/File:Max_Euwe_Schaakvierkamp_in_Amsterdam_Kortsjnoj_(close),_Bestanddeelnr_933-9735_(cropped).jpg) | Bart Molendijk / Anefo | CC0 |
| `Smyslov.jpg` | [Interpolisschaaktoernooi Tilburg 1819 Smyslov aan zet, Bestanddeelnr 929-3630.jpg](https://commons.wikimedia.org/wiki/File:Interpolisschaaktoernooi_Tilburg_1819_Smyslov_aan_zet,_Bestanddeelnr_929-3630.jpg) | Koen Suyk / Anefo | CC0 |
| `Tal.jpg` | [Hoogovenschaaktoernooi, de Rus M. Tal, Bestanddeelnr 920-9788.jpg](https://commons.wikimedia.org/wiki/File:Hoogovenschaaktoernooi,_de_Rus_M._Tal,_Bestanddeelnr_920-9788.jpg) | Ron Kroon for Anefo | CC0 |
| `Petrosian.jpg` | [Tigran Petrosian 1962.jpg](https://commons.wikimedia.org/wiki/File:Tigran_Petrosian_1962.jpg) | Harry Pot / Anefo | CC0 |
| `Spassky.jpg` | [Dhr. Boris Spassky, Bestanddeelnr 932-7320.jpg](https://commons.wikimedia.org/wiki/File:Dhr._Boris_Spassky,_Bestanddeelnr_932-7320.jpg) | Rob Bogaerts for Anefo | CC0 |
| `Fischer.jpg` | [Bobby Fischer 1972.jpg](https://commons.wikimedia.org/wiki/File:Bobby_Fischer_1972.jpg) | Bert Verhoeff for Anefo | CC0 |
| `Karpov.jpg` | [Anatoly Karpov 2017 april.jpg](https://commons.wikimedia.org/wiki/File:Anatoly_Karpov_2017_april.jpg) | Veni Markovski / Вени Марковски | CC BY-SA 4.0 |
| `Kasparov.jpg` | [Garry Kasparov European Union 2023 (cropped).jpg](https://commons.wikimedia.org/wiki/File:Garry_Kasparov_European_Union_2023_(cropped).jpg) | Lukasz Kobus | CC BY 4.0 |
| `Kramnik.jpg` | [Candidates Tournament 2018, Vladimir Kramnik.jpg](https://commons.wikimedia.org/wiki/File:Candidates_Tournament_2018,_Vladimir_Kramnik.jpg) | Vladimir Barskij | CC BY-SA 3.0 |
| `Anand.jpg` | [Viswanathan Anand (2016).jpeg](https://commons.wikimedia.org/wiki/File:Viswanathan_Anand_(2016).jpeg) | Wolfgang Jekel | CC BY 2.0 |
| `Carlsen.jpg` | [Magnus Carlsen in 2025.jpg](https://commons.wikimedia.org/wiki/File:Magnus_Carlsen_in_2025.jpg) | Miroslav.vajdic | CC BY 4.0 |
| `Ding.jpg` | [DingLiren24a.jpg](https://commons.wikimedia.org/wiki/File:DingLiren24a.jpg) | Stefan64 | CC BY-SA 3.0 |

## Звуки и текстуры

| Что | Источник | Лицензия |
|---|---|---|
| Звуки ходов и сигналов | Синтезируются в браузере (`frontend/src/services/soundEngine.ts`), записей нет | собственная работа |
| `frontend/public/assets/textures/wood-grain.svg` | Процедурная графика проекта (SVG-фильтр) | собственная работа, CC0-1.0 |

Убраны: `Move.mp3`, `Capture.mp3`, `GenericNotify.mp3` (звуки lichess, отнесённые в его COPYING.md к несвободным) и
`wood-grain.png` (происхождение неизвестно).

## Внешние сервисы

| Что | Автор | Условия | Примечание |
|---|---|---|---|
| Аватары игроков — [DiceBear](https://www.dicebear.com), стиль Bottts Neutral | Pablo Stanley (исходный набор Bottts), DiceBear | Free for personal and commercial use | Картинка запрашивается с `api.dicebear.com`, имя игрока уходит на сторонний сервер. |

## Данные

| Что | Источник | Статус |
|---|---|---|
| Архив исторических партий | PGN-коллекции pgnmentor.com (`src/db/seed.py`), загрузчик `scripts/chessgames_downloader.py` | Запись ходов партии — факт, авторским правом не охраняется. Условия сайтов-источников и права на подборку как базу данных не проверялись — см. «Открытые вопросы». |
| Дебютные книги ботов (`src/services/bots/books/*.json`) | Построены `scripts/build_opening_books.py` из тех же партий | Статистика ходов, собственная обработка. |

## Программные библиотеки

Полные списки — `requirements.txt` и `frontend/package.json`. Основные: FastAPI, SQLAlchemy, Pydantic, Celery,
redis-py (MIT / BSD); React, React Router, Tailwind CSS, Recharts, date-fns (MIT); lucide (ISC); chess.js
(BSD-2-Clause); **python-chess (GPL-3.0)**.

## Открытые вопросы

* **python-chess — GPL-3.0.** Пока сервер работает как сетевой сервис и его код никому не передаётся, GPL-3.0
  обязательств не создаёт. Если серверный код будет распространяться (в том числе как закрытый продукт), он должен
  распространяться на условиях GPL-3.0.
* **У самого проекта нет файла `LICENSE`.** Без него права на код формально не определены.
* **Источники PGN.** Перед публичным запуском стоит перейти на коллекцию с явным разрешением на использование или
  проверить условия pgnmentor.com и chessgames.com.
* **Аватары DiceBear** раскрывают имена игроков стороннему сервису — стоит генерировать их у себя.
