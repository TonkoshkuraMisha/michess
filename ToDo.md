# ♟️ Линейный план разработки Michess (PvP Self-Product Roadmap)

# Сделать рефакторинг ботов. Один базовый бот. От него наследуются исторические персоны.
# Идеально близко к шахматистам реализовать тайминги ходов
# Продумать и реализовать максимально-максимальную аутентичность стиля игры




## 🛠 Базовый шаблон команд для каждого таска (Золотой стандарт)

Перед началом **любого** таска:

```powershell
git checkout dev
git pull origin dev
git checkout -b <имя-ветки-из-таска>
```

После написания кода и прохождения тестов — слияние в `dev`:

```powershell
git status
git add .
git commit -m "<сообщение-коммита-из-таска>"
git checkout dev
git merge --no-ff <имя-ветки-из-таска> -m "Merge <имя-ветки-из-таска> into dev"
git push origin dev
git branch -d <имя-ветки-из-таска>
```

---

## СПРИНТ 1. Стабилизация фундамента, зависимостей и CI/CD

Прежде чем наращивать фичи, устраняем технические рассинхроны в текущем состоянии проекта.

### - [ ] Таск 1.1. Синхронизация `requirements.txt` и починка пайплайна `.github/workflows/ci.yml`

* **Техническая причина:** В `requirements.txt` отсутствуют пакеты `celery`, `stockfish`, `requests`, а также тестовые
  библиотеки (`pytest`, `pytest-asyncio`, `httpx`, `aiosqlite`, `flake8`). В `.github/workflows/ci.yml` указана ветка
  `"develop"` вместо рабочей ветки `"dev"`, и не запускаются проверки фронтенда.
* **Ветка Git:** `chore/fix-deps-and-ci`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b chore/fix-deps-and-ci
  ```
* **Что сделать:**
    1. Добавить в `requirements.txt` недостающие пакеты (`celery`, `stockfish`, `requests`, `pytest`, `pytest-asyncio`,
       `httpx`, `aiosqlite`, `flake8`).
    2. В `.github/workflows/ci.yml` заменить `"develop"` на `"dev"` и добавить джобу `frontend-test` (Node.js 24,
       `npm ci`, `npm run lint`, `npm run test`, `npm run build`).
    3. Удалить устаревший атрибут `version: '3.8'` из `docker-compose.yml`.
* **Тестирование:**
  ```powershell
  python -m flake8 src tests --count --select=E9,F63,F7,F82 --show-source --statistics
  python -m pytest -v
  cd frontend && npm run lint && npm run test && npm run build && cd ..
  ```
* **Коммит:** `chore: sync requirements.txt and enable fullstack CI on dev branch`

---

### - [ ] Таск 1.2. Вынос API/WS URL в переменные окружения фронтенда (`.env`)

* **Техническая причина:** В `App.tsx`, `AuthModal.tsx`, `Profile.tsx`, `ChampionGames.tsx`, `GameViewer.tsx`,
  `Chessboard.tsx` и `gameSocket.ts` захардкожен адрес `http://127.0.0.1:8000` и `ws://127.0.0.1:8000`. При деплое или
  игре по локальной сети с другого устройства приложение не сможет подключиться к серверу.
* **Ветка Git:** `refactor/frontend-api-config`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b refactor/frontend-api-config
  ```
* **Что сделать:**
    1. Создать файл `frontend/src/config/api.ts`, экспортирующий
       `API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'` и
       `WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000'`.
    2. Заменить все хардкодные ссылки во всех компонентах фронтенда на импорт из `src/config/api.ts`.
* **Тестирование:**
    * Добавить unit-тест в `frontend/src/services/__tests__/gameSocket.test.ts`, проверяющий корректность формирования
      URL подключения.
  ```powershell
  cd frontend && npm run test && npm run build && cd ..
  ```
* **Коммит:** `refactor: centralize API and WebSocket URLs in frontend config`

---

## СПРИНТ 2. Доведение ядра PvP-геймплея до профессионального стандарта

Чтобы сильные шахматисты (1 разряд, КМС, мастера) воспринимали платформу всерьёз, механика доски и часов должна работать
безупречно в цейтноте.

### - [ ] Таск 2.1. Диалог выбора фигуры при превращении пешки (Pawn Promotion UI)

* **Техническая причина:** В `Chessboard.tsx` в функции `executeMove` стоит жёсткая заглушка `promotion: 'q'`
  (`const move = nextGame.move({from, to, promotion: 'q'})`). Игрок не может превратить пешку в коня (с шахом или
  вилкой), ладью или слона (чтобы избежать пата).
* **Ветка Git:** `feature/pawn-promotion-modal`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/pawn-promotion-modal
  ```
* **Что сделать:**
    1. В `frontend/src/components/Chessboard.tsx` перед вызовом `executeMove(from, to)` проверять: если ходит пешка
       (`p`) и целевая горизонталь `8` (для белых) или `1` (для чёрных), открывать компактную плашку выбора фигуры (`♛`,
       `♞`, `♜`, `♝`) прямо над полем превращения.
    2. Передавать выбранный символ (`'q' | 'n' | 'r' | 'b'`) в `nextGame.move({ from, to, promotion })` и формировать
       5-символьный UCI-ход (например, `e7e8n`) для отправки по WebSocket в `make_move`.
* **Тестирование:**
    * В `tests/test_game_engine.py` добавить тест `test_underpromotion_to_knight`, проверяющий, что UCI-ход `a7a8n`
      корректно создаёт коня на `a8` и записывает `a8=N` в SAN.
  ```powershell
  python -m pytest tests/test_game_engine.py -v
  ```
* **Коммит:** `feat: add interactive pawn promotion piece selector (Q, N, R, B)`

---

### - [ ] Таск 2.2. Система предходов (Premoves) для Bullet и Blitz

* **Техническая причина:** В базе данных (`moves.is_premove`) и в протоколе WebSocket (`is_premove`) поле уже заложено,
  но в `Chessboard.tsx` всегда отправляется `is_premove: false`. Без предходов играть в Пулю (1+0) и Блиц (3+0) на
  высоком уровне невозможно.
* **Ветка Git:** `feature/premove-system`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/premove-system
  ```
* **Что сделать:**
    1. В `Chessboard.tsx` добавить стейт `premove: { from: string; to: string; promotion?: string } | null`.
    2. Если сейчас ход соперника (`gameId && currentTurnColor !== myColor`), позволить игроку перетащить или кликнуть
       свою фигуру на любую клетку: сохранять это в `premove` и подсвечивать клетки `from`/`to` красновато-янтарным
       цветом (`bg-rose-500/40`). Правый клик или клик на пустую клетку сбрасывает `premove`.
    3. В обработчике `handleMoveMade` (когда пришёл ход от соперника), если `premove` задан и ход легален в новой
       позиции, мгновенно выполнять его с флагом `is_premove: true` и `time_taken_ms: 0`.
* **Тестирование:**
    * В `tests/test_websockets_flow.py` добавить проверку сохранения флага `is_premove=True` в телеметрии хода.
  ```powershell
  python -m pytest tests/test_websockets_flow.py -v
  ```
* **Коммит:** `feat: implement client-side premoves with visual highlighting`

---

### - [ ] Таск 2.3. Авто-отмена партии при неявке на 1-м ходу (Abort Game) и защита от дисконнекта

* **Техническая причина:** Если соперник нашёл игру и закрыл вкладку, не сделав первого хода, второй игрок вынужден
  ждать истечения всех 10 или 15 минут.
* **Ветка Git:** `feature/abort-and-reconnect-grace`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/abort-and-reconnect-grace
  ```
* **Что сделать:**
    1. В `src/services/game_state.py` в цикле `check_timeouts_loop`: если в партии сделано `< 2` полуходов (первый ход
       белых или первый ответ чёрных) и с момента старта/хода прошло более **30 секунд**, автоматически завершать партию
       со статусом `ABORTED` (`result = "*"`, `termination = "aborted"`, без изменения рейтинга).
    2. Добавить WebSocket-экшен `abort_game`, позволяющий игроку вручную отменить партию в первые 2 полухода, и кнопку
       «Отменить игру» в `Chessboard.tsx` (которая меняется на «Сдаться», когда `history.length >= 2`).
* **Тестирование:**
    * В `tests/test_game_state.py` написать тест `test_abort_game_without_rating_change`, проверяющий, что при отмене на
      1-м ходу рейтинги обоих игроков остаются неизменными.
  ```powershell
  python -m pytest tests/test_game_state.py -v
  ```
* **Коммит:** `feat: add 30s first-move auto-abort and manual abort before move 2`

---

## СПРИНТ 3. Социальный PvP: Реванши, Приватные вызовы по ссылке, Зрители и Чат

Этот спринт делает из набора отдельных партий живой шахматный клуб, куда можно позвать друга или ученика по прямой
ссылке.

### - [ ] Таск 3.1. Система мгновенного реванша («Реванш» / Rematch) с переменой цвета

* **Техническая причина:** После окончания партии в `Chessboard.tsx` есть только кнопка возврата в лобби. В PvP игроки
  почти всегда хотят сыграть серию партий друг с другом со сменой цвета.
* **Ветка Git:** `feature/rematch-system`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/rematch-system
  ```
* **Что сделать:**
    1. В `src/api/websockets.py` добавить экшены `offer_rematch`, `accept_rematch`, `decline_rematch`.
    2. При `accept_rematch` сервер создаёт новую партию в БД и Redis с тем же контролем времени (`base_time_ms`,
       `increment_ms`), но **меняет местами белых и чёрных** (`white_id` <-> `black_id`), и рассылает обоим событие
       `match_found`.
    3. В `Chessboard.tsx` при `gameOverResult` показывать кнопку «Предложить реванш» (или «Принять реванш», если
       соперник нажал первым) рядом с кнопкой «В лобби».
* **Тестирование:**
    * В `tests/test_websockets_flow.py` добавить тест `test_rematch_swaps_colors`, проверяющий смену цветов игроков во
      второй партии подряд.
  ```powershell
  python -m pytest tests/test_websockets_flow.py -v
  ```
* **Коммит:** `feat: implement instant post-game rematch with color swap`

---

### - [ ] Таск 3.2. Приватные вызовы по прямой ссылке (Игра с другом / учеником)

* **Техническая причина:** Для self-product портала критически важна возможность создать кастомный вызов (контроль
  времени + выбор цвета: Белые / Чёрные / Случайный), скопировать ссылку вида
  `http://localhost:5173/challenge/abc123xyz` и скинуть её сопернику в мессенджер.
* **Ветка Git:** `feature/private-challenge-links`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/private-challenge-links
  ```
* **Что сделать:**
    1. В `src/services/matchmaker.py` добавить методы
       `create_private_invite(user_id, base_time_ms, increment_ms, color_pref)` (хранится в Redis с TTL 15 минут по
       ключу `invite:{code}`) и `accept_private_invite(code, acceptor_id)`.
    2. В `src/api/profile.py` и `src/api/websockets.py` добавить создание и принятие инвайта по коду.
    3. В левой колонке `Chessboard.tsx` добавить кнопку «Играть с другом (по ссылке)», которая генерирует ссылку,
       копирует её в буфер обмена и ждёт подключения второго игрока.
* **Тестирование:**
    * Написать тест в `tests/test_game_state.py` на создание и погашение приватного инвайта в Redis.
  ```powershell
  python -m pytest tests/test_game_state.py -v
  ```
* **Коммит:** `feat: add shareable challenge links with custom time and color preference`

---

### - [ ] Таск 3.3. Режим зрителя (Spectator Mode) и вкладка «Текущие партии (Live)»

* **Техническая причина:** Наблюдение за чужими партиями в реальном времени — обязательная часть шахматного клуба
  (позволяет следить за игрой сильных игроков или учеников).
* **Ветка Git:** `feature/spectator-mode`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/spectator-mode
  ```
* **Что сделать:**
    1. В `src/services/connection_manager.py` добавить словарь `game_spectators: dict[int, set[int]]` (подписка
       пользователей на рассылку событий конкретной `game_id`).
    2. В `src/api/websockets.py` добавить экшены `spectate_game` и `leave_spectate`, а при каждом `move_made` и
       `game_over` дублировать сообщение всем подписанным зрителям этой партии.
    3. В `src/api/profile.py` добавить эндпоинт `GET /api/v1/profile/games/live`, возвращающий список активных партий из
       Redis (`status == "in_progress"`).
    4. В левой панели `Chessboard.tsx` добавить переключатель вкладок: **«Вызовы (Лобби)»** | **«Идут сейчас (Live)»**,
       чтобы в один клик подключаться к просмотру любой идущей партии.
* **Тестирование:**
    * В `tests/test_websockets_flow.py` добавить тест `test_spectator_receives_live_moves`.
  ```powershell
  python -m pytest tests/test_websockets_flow.py -v
  ```
* **Коммит:** `feat: add live games list and real-time WebSocket spectator mode`

---

### - [ ] Таск 3.4. Компактный игровой чат и быстрые реплики сопернику

* **Техническая причина:** Вежливый обмен репликами («Привет! Удачи!», «Хорошая партия!») создаёт атмосферу живой игры
  человека с человеком.
* **Ветка Git:** `feature/in-game-chat`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/in-game-chat
  ```
* **Что сделать:**
    1. В `src/api/websockets.py` добавить обработку `action == "chat_message"` с защитой от спама (лимит длины 140
       символов, отправка участникам и зрителям `game_id`).
    2. В правой колонке `Chessboard.tsx` под журналом ходов добавить компактный блок чата и 4 кнопки быстрых фраз
       (`👋 Удачи!`, `🤝 Спасибо за игру!`, `👏 Красивый ход!`, `⏱ Цейтнот!`).
* **Тестирование:**
    * Проверить пересылку `chat_message` в `tests/test_websockets_flow.py`.
  ```powershell
  python -m pytest tests/test_websockets_flow.py -v
  ```
* **Коммит:** `feat: add real-time in-game chat and quick etiquette presets`

---

## СПРИНТ 4. Умная интеграция Stockfish (Анализ по запросу и Доска анализа)

Вместо фонового анализа всех партий подряд делаем **анализ по клику** на странице разбора партии (`GameViewer.tsx`).

### - [ ] Таск 4.1. Разбор всей партии движком по кнопке (Accuracy, Blunders, Evaluation Graph)

* **Техническая причина:** Есть `src/api/analysis.py` и `src/services/analysis_service.py` для оценки одной позиции.
  Нужно добавить эндпоинт полного экспресс-разбора завершённой партии (`POST /api/v1/analysis/game/{game_id}`), который
  на глубине `depth=12` за 2–3 секунды считает оценку каждого хода, находит зевки (`Blunder`, `Mistake`, `Inaccuracy`,
  `Best`) и сохраняет JSON-отчёт в БД.
* **Ветка Git:** `feature/on-demand-game-analysis`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/on-demand-game-analysis
  ```
* **Что сделать:**
    1. В модель `Game` (`src/models/game.py`) добавить текстовое/JSON поле `analysis_json` и сгенерировать миграцию
       Alembic:
       ```powershell
       alembic revision --autogenerate -m "add_analysis_json_to_game"
       alembic upgrade head
       ```
    2. В `src/services/analysis_service.py` реализовать метод `analyze_full_game(db, game_id)`: проход по всем полуходам
       PGN, расчёт `cp_loss` (потери сантипешек), классификация каждого хода (`Best`, `Good`, `Inaccuracy ?!`,
       `Mistake ?`, `Blunder ??`) и расчёт общей точности Белых и Чёрных в процентах (`0–100%`).
    3. Если бинарник Stockfish не найден по пути из `.env`, возвращать fallback-оценку, чтобы тесты в CI не падали без
       бинарника.
* **Тестирование:**
    * Создать `tests/test_analysis_service.py`, тестирующий математику расчёта точности (`calculate_accuracy`) и
      классификацию зевков по дельте сантипешек.
  ```powershell
  python -m pytest tests/test_analysis_service.py -v
  ```
* **Коммит:** `feat: implement on-demand full game analysis with accuracy and blunder classification`

---

### - [ ] Таск 4.2. Шкала оценки (Evaluation Bar), график перевеса и стрелки на доске в `GameViewer.tsx`

* **Техническая причина:** В `GameViewer.tsx` сейчас можно только листать ходы. Добавление вертикальной шкалы оценки
  слева от доски, графика перевеса (через уже установленный `recharts`) и рисования стрелок правой кнопкой мыши
  превратит `GameViewer` в полноценную студию разбора.
* **Ветка Git:** `feature/game-viewer-eval-bar-and-arrows`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/game-viewer-eval-bar-and-arrows
  ```
* **Что сделать:**
    1. В `frontend/src/components/GameViewer.tsx` добавить вертикальную шкалу оценки (`EvalBar`) слева от доски,
       показывающую текущий перевес (например, `+1.4`, `-0.8`, `M3`).
    2. Добавить кнопку **«Компьютерный анализ»**, вызывающую `POST /api/v1/analysis/game/{gameId}` и отображающую:
        * Точность Белых и Чёрных (`%`), количество зевков (`??`), ошибок (`?`) и неточностей (`?!`).
        * Интерактивный график перевеса (`AreaChart` из `recharts`), по клику на точку которого доска сразу переходит к
          нужному ходу.
    3. Добавить поддержку рисования стрелок и выделения полей **правой кнопкой мыши** (SVG-оверлей поверх доски) для
       самостоятельного расчёта вариантов.
* **Тестирование:**
  ```powershell
  cd frontend && npm run lint && npm run test && npm run build && cd ..
  ```
* **Коммит:** `feat: add Evaluation Bar, Recharts advantage graph, and right-click arrows to GameViewer`

---

## СПРИНТ 5. Прагматичный Античит на базе уже собираемой телеметрии

В таблице `moves` уже сохраняются `time_taken_ms`, `window_blurred_before_move`, `is_premove`, `network_lag_ms`, а у
пользователя есть `trust_factor` и `is_cheater`. Заставляем эти данные работать без нагрузки на CPU.

### - [ ] Таск 5.1. Детектор аномалий поведения (Timing Variance + Tab-Switch)

* **Техническая причина:** Читеры, использующие подсказки с соседней вкладки или второй программы, выдают себя двумя
  детерминированными паттернами:
    1. Регулярный уход из вкладки (`window_blurred_before_move == True`) перед сложными ходами в миттельшпиле.
    2. «Роботизированный тайминг» — почти одинаковое время на каждый ход (низкое среднеквадратичное отклонение времени
       хода, например, каждые 4–6 секунд вне зависимости от сложности позиции).
* **Ветка Git:** `feature/telemetry-anticheat-service`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/telemetry-anticheat-service
  ```
* **Что сделать:**
    1. Создать сервис `src/services/anticheat.py` с функцией `evaluate_game_telemetry(db, game_id)`.
    2. После завершения рейтинговой партии (в `state_manager.finish_game`) вызывать этот анализатор:
        * Считать долю ходов с потерей фокуса окна (`blur_ratio`) после 8-го хода.
        * Считать коэффициент вариации времени ходов (исключая `is_premove == True`).
        * При подозрительных показателях снижать `user.trust_factor` (со 100 вниз). Если `trust_factor < 30`, выставлять
          `is_cheater = True`.
    3. В профиле игрока (`Profile.tsx`) отображать бейдж репутации («Высокий фактор доверия» / «Под наблюдением Fair
       Play»).
* **Тестирование:**
    * Создать `tests/test_anticheat.py`: протестировать расчёт `trust_factor` на серии «человеческих» ходов (разное
      время, без ухода из вкладки) и «читерских» ходов (постоянный `window_blurred_before_move=True` и монотонное время
      4500 мс).
  ```powershell
  python -m pytest tests/test_anticheat.py -v
  ```
* **Коммит:** `feat: implement deterministic anti-cheat telemetry analyzer and trust factor updates`

---

## СПРИНТ 6. Оптимизация Архива Чемпионов и финальная полировка (Production Ready)

### - [ ] Таск 6.1. Оптимизация SQL-запросов истории партий и сидера Чемпионов (`src/api/profile.py` и `src/db/seed.py`)

* **Техническая причина:** В `src/api/profile.py` функция `get_user_games` сейчас выгружает **все** партии игрока из БД
  в память Python (`games_result.all()`) и на каждый HTTP-запрос регулярными выражениями парсит `game.pgn`, чтобы
  достать `Result`, `Date`, `Site`, `ECO`.
* **Ветка Git:** `perf/optimize-games-query-and-seeder`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b perf/optimize-games-query-and-seeder
  ```
* **Что сделать:**
    1. Добавить в модель `Game` (`src/models/game.py`) индексированные колонки `pgn_date` (`String(20)`), `site`
       (`String(100)`), `eco` (`String(10)`) и выполнить миграцию Alembic:
       ```powershell
       alembic revision --autogenerate -m "add_metadata_columns_to_games"
       alembic upgrade head
       ```
    2. Обновить `src/db/seed.py` и `state_manager.finish_game`, чтобы эти поля заполнялись один раз при сохранении
       партии в БД.
    3. В `src/api/profile.py` перевести пагинацию и сортировку `get_user_games` на чистый SQL (`ORDER BY`, `LIMIT`,
       `OFFSET` на уровне PostgreSQL) без загрузки всех PGN в оперативную память.
* **Тестирование:**
  ```powershell
  python -m pytest -v
  ```
* **Коммит:** `perf: store game metadata in indexed DB columns and use SQL pagination`

---

### - [ ] Таск 6.2. Touch-адаптация доски для планшетов и смартфонов + таблица лидеров (`Leaderboard`)

* **Техническая причина:**
    1. На бэкенде в `src/api/profile.py` уже написан готовый эндпоинт `GET /api/v1/profile/leaderboard`, но на фронтенде
       для него ещё нет страницы.
    2. В `Chessboard.tsx` перетаскивание фигур завязано на `onMouseDown` / `mousemove` / `mouseup`. Добавление
       `Pointer Events` (`onPointerDown`, `pointermove`, `pointerup`) позволит комфортно двигать фигуры пальцем на
       телефоне или планшете.
* **Ветка Git:** `feature/leaderboard-and-touch-support`
* **Команда старта:**
  ```powershell
  git checkout dev && git pull origin dev && git checkout -b feature/leaderboard-and-touch-support
  ```
* **Что сделать:**
    1. Создать компонент `frontend/src/components/Leaderboard.tsx` (и роут `/leaderboard` в `App.tsx`), подключив его к
       `GET /api/v1/profile/leaderboard`.
    2. В `Chessboard.tsx` и `GameViewer.tsx` адаптировать `boardSize` под ширину мобильного экрана
       (`Math.min(boardSize, window.innerWidth - 24)`) и заменить мышиные события перетаскивания на универсальные
       `Pointer Events`.
* **Тестирование:**
  ```powershell
  cd frontend && npm run lint && npm run test && npm run build && cd ..
  ```
* **Коммит:** `feat: add Leaderboard page and responsive touch/pointer support for chessboard`

---

### - [ ] Таск 6.3. Финальный релиз в ветку `master`

Когда все 6 спринтов пройдены, протестированы и влиты в `dev`, выпускаем чистый стабильный релиз:

```powershell
# 1. Финальный прогон всех тестов бэкенда и фронтенда
python -m flake8 src tests --count --select=E9,F63,F7,F82 --show-source --statistics
python -m pytest -v
cd frontend && npm run lint && npm run test && npm run build && cd ..

# 2. Слияние dev в релизную ветку master
git checkout master
git pull origin master
git merge --no-ff dev -m "Release v1.0: Full PvP Chess Portal with Stockfish Analysis and Anti-Cheat"
git push origin master

# 3. Возвращаемся в рабочую ветку dev
git checkout dev
```