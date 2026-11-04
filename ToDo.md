<!-- --- FILE: ToDo.md --- -->

# ♟️ Линейный план разработки Michess (PvP Self-Product Roadmap)

## 🏆 Глобальные цели по историческим ботам

* [x] Сделать рефакторинг ботов: один базовый класс `HistoricalBot`, от которого наследуются исторические персоны
  (`philidor`, `labourdonnais`, `staunton`, `anderssen`, `morphy`, `paulsen`, `zukertort`).
* [x] Реализовать реалистичные человеческие тайминги ходов в зависимости от фазы партии (дебют, миттельшпиль, эндшпиль),
  сложности позиции и оставшегося времени на часах (`_simulate_human_thinking_time`).
* [x] Реализовать максимальную аутентичность стиля игры: JSON-книги дебютов из реальных исторических PGN + тактический
  расчёт через Stockfish 19 (`analyse_with_stockfish`) с индивидуальной системой стилевых бонусов
  (`evaluate_style_bonus`).

---

## 🛠 Базовый шаблон команд для каждого таска (Золотой стандарт)

Перед началом **любого** таска:

    git checkout dev
    git pull origin dev
    git checkout -b <имя-ветки-из-таска>

После написания кода и прохождения тестов — слияние в `dev`:

    git status
    git add .
    git commit -m "<сообщение-коммита-из-таска>"
    git checkout dev
    git merge --no-ff <имя-ветки-из-таска> -m "Merge <имя-ветки-из-таска> into dev"
    git push origin dev
    git branch -d <имя-ветки-из-таска>

---

## СПРИНТ 1. Стабилизация фундамента, зависимостей и CI/CD (ВЫПОЛНЕНО ✅)

### - [x] Таск 1.1. Синхронизация `requirements.txt` и починка пайплайна `.github/workflows/ci.yml`

* **Техническая причина:** В `requirements.txt` отсутствовали пакеты `celery`, `stockfish`, `requests`, а также тестовые
  библиотеки (`pytest`, `pytest-asyncio`, `httpx`, `aiosqlite`, `flake8`). В `.github/workflows/ci.yml` была указана
  ветка `"develop"` вместо рабочей ветки `"dev"`, не устанавливался Stockfish и не запускались проверки фронтенда.
* **Ветка Git:** `chore/fix-deps-and-ci`
* **Что сделано:**
    1. Добавлены все зависимости в `requirements.txt`.
    2. В `.github/workflows/ci.yml` настроены джобы `backend-test` (с установкой Stockfish и Redis) и `frontend-test`
       (Node.js 24, `npm ci`, `npm run lint`, `npm run test`, `npm run build`).
    3. Очищен `docker-compose.yml`.
* **Тестирование:**

  python -m flake8 src tests scripts --count --select=E9,F63,F7,F82 --show-source --statistics
  python -m pytest -v
  cd frontend && npm run lint && npm run test && npm run build && cd ..

* **Коммит:** `chore: sync requirements.txt and enable fullstack CI on dev branch`

---

### - [x] Таск 1.2. Вынос API/WS URL в переменные окружения фронтенда (`.env`)

* **Техническая причина:** Во всех компонентах фронтенда были захардкожены адреса
  `[http://127.0.0.1:8000](http://127.0.0.1:8000)` и `ws://127.0.0.1:8000`.
* **Ветка Git:** `refactor/frontend-api-config`
* **Что сделано:**
    1. Создан файл `frontend/src/config/api.ts`, экспортирующий `API_BASE_URL` и `WS_BASE_URL`.
    2. Все ссылки в `App.tsx`, `AuthModal.tsx`, `Profile.tsx`, `ChampionGames.tsx`, `GameViewer.tsx`, `Chessboard.tsx` и
       `gameSocket.ts` переведены на импорт из `src/config/api.ts`.
    3. Добавлены unit-тесты в `frontend/src/services/__tests__/gameSocket.test.ts`.
* **Тестирование:**

  cd frontend && npm run test && npm run build && cd ..

* **Коммит:** `refactor: centralize API and WebSocket URLs in frontend config`

---

## СПРИНТ 2. Доведение ядра PvP-геймплея до профессионального стандарта (ВЫПОЛНЕНО ✅)

### - [x] Таск 2.1. Диалог выбора фигуры при превращении пешки (Pawn Promotion UI)

* **Техническая причина:** В `Chessboard.tsx` стояла заглушка автопревращения только в ферзя (`promotion: 'q'`).
* **Ветка Git:** `feature/pawn-promotion-modal`
* **Что сделано:**
    1. В `frontend/src/components/Chessboard.tsx` добавлено модальное окно выбора фигуры (`Ферзь`, `Конь`, `Ладья`,
       `Слон`) при ходе пешки на 8-ю или 1-ю горизонталь.
    2. На бэкенде и в `tests/test_game_engine.py` протестировано превращение в коня и ладью
       (`test_underpromotion_to_knight_and_rook`).
* **Тестирование:**

  python -m pytest tests/test_game_engine.py -v

* **Коммит:** `feat: add interactive pawn promotion piece selector (Q, N, R, B)`

---

### - [x] Таск 2.2. Система предходов (Premoves) для Bullet и Blitz

* **Техническая причина:** Для комфортной игры в Bullet и Blitz необходима возможность сделать предход на времени
  соперника.
* **Ветка Git:** `feature/premove-system`
* **Что сделано:**
    1. В `Chessboard.tsx` добавлен стейт `premove` с визуальной подсветкой полей (`bg-rose-500/45`) и сбросом по правому
       клику или кнопке отмены.
    2. Автоматическое выполнение предхода при получении хода соперника с передачей флага `is_premove: true` и
       `time_taken_ms: 0`.
    3. Добавлен тест `test_premove_telemetry_saved_and_bot_thinking_time` в `tests/test_websockets_flow.py`.
* **Тестирование:**

  python -m pytest tests/test_websockets_flow.py -v

* **Коммит:** `feat: implement client-side premoves with visual highlighting`

---

### - [x] Таск 2.3. Авто-отмена партии при неявке на 1-м ходу (Abort Game) и защита от дисконнекта

* **Техническая причина:** Защита игроков от ожидания полного таймера, если соперник не сделал первый ход.
* **Ветка Git:** `feature/abort-and-reconnect-grace`
* **Что сделано:**
    1. В `src/services/game_state.py` реализована отмена партии без изменения рейтинга (`status = ABORTED`,
       `result = "*"`, `termination = "aborted"`), если сделано менее 2 полуходов.
    2. Добавлен WebSocket-экшен `abort_game` и кнопка «Отменить игру» в `Chessboard.tsx`.
    3. Добавлен тест `test_abort_game_without_rating_change` в `tests/test_game_state.py`.
* **Тестирование:**

  python -m pytest tests/test_game_state.py -v

* **Коммит:** `feat: add 30s first-move auto-abort and manual abort before move 2`

---

## СПРИНТ 3. Социальный PvP: Реванши, Приватные вызовы по ссылке, Зрители и Чат (ВЫПОЛНЕНО ✅)

### - [x] Таск 3.1. Система мгновенного реванша («Реванш» / Rematch) с переменой цвета

* **Ветка Git:** `feature/rematch-system`
* **Что сделано:**
    1. В `src/api/websockets.py` реализованы экшены `offer_rematch`, `accept_rematch`, `decline_rematch` и функция
       `create_rematch_game` со сменой цвета игроков (`white_id <-> black_id`).
    2. В `Chessboard.tsx` добавлены кнопки предложения и принятия реванша после завершения партии.
    3. Добавлен тест `test_rematch_swaps_colors` в `tests/test_websockets_flow.py`.
* **Тестирование:**

  python -m pytest tests/test_websockets_flow.py -v

* **Коммит:** `feat: implement instant post-game rematch with color swap`

---

### - [x] Таск 3.2. Приватные вызовы по прямой ссылке (Игра с другом / учеником)

* **Ветка Git:** `feature/private-challenge-links`
* **Что сделано:**
    1. В `src/services/matchmaker.py` реализованы методы `create_private_invite` и `accept_private_invite` в Redis (ключ
       `invite:{code}`).
    2. В `App.tsx` и `Chessboard.tsx` добавлен роут `/challenge/:inviteCode` и панель генерации ссылки с выбором цвета
       (`Белые`, `Чёрные`, `Случайно`).
    3. Добавлен тест `test_private_invite_create_and_redeem` в `tests/test_game_state.py`.
* **Тестирование:**

  python -m pytest tests/test_game_state.py -v

* **Коммит:** `feat: add shareable challenge links with custom time and color preference`

---

### - [x] Таск 3.3. Режим зрителя (Spectator Mode) и вкладка «Текущие партии (Live)»

* **Ветка Git:** `feature/spectator-mode`
* **Что сделано:**
    1. В `src/services/connection_manager.py` добавлена подписка зрителей `game_spectators` и трансляция ходов/чата.
    2. В `src/api/profile.py` добавлен эндпоинт `GET /api/v1/profile/games/live`.
    3. В `Chessboard.tsx` добавлена вкладка «Идут сейчас (Live)» с кнопкой просмотра.
    4. Добавлен тест `test_spectator_receives_live_moves_and_chat` в `tests/test_websockets_flow.py`.
* **Тестирование:**

  python -m pytest tests/test_websockets_flow.py -v

* **Коммит:** `feat: add live games list and real-time WebSocket spectator mode`

---

### - [x] Таск 3.4. Компактный игровой чат и быстрые реплики сопернику

* **Ветка Git:** `feature/in-game-chat`
* **Что сделано:**
    1. В `src/api/websockets.py` реализована пересылка `chat_message` с ограничением 140 символов.
    2. В `Chessboard.tsx` добавлен блок чата и 4 быстрые реплики (`👋 Удачи!`, `🤝 Спасибо за игру!`, `👏 Красивый ход!`,
       `⏱ Цейтнот!`).
* **Тестирование:**

  python -m pytest tests/test_websockets_flow.py -v

* **Коммит:** `feat: add real-time in-game chat and quick etiquette presets`

---

## СПРИНТ 4. Умная интеграция Stockfish (Анализ по запросу и Доска анализа) (ВЫПОЛНЕНО ✅)

### - [x] Таск 4.1. Разбор всей партии движком по кнопке (Accuracy, Blunders, Evaluation Graph)

* **Ветка Git:** `feature/on-demand-game-analysis`
* **Что сделано:**
    1. В модель `Game` (`src/models/game.py`) добавлено поле `analysis_json` и применена миграция Alembic
       `c8a91e2f4b10_add_analysis_json_to_game.py`.
    2. В `src/services/analysis_service.py` реализован метод `analyze_full_game` с расчётом `cp_loss`, точности
       (`calculate_accuracy`) и классификацией ходов (`Best`, `Good`, `Inaccuracy`, `Mistake`, `Blunder`).
    3. Создан `tests/test_analysis_service.py`.
* **Тестирование:**

  python -m pytest tests/test_analysis_service.py -v

* **Коммит:** `feat: implement on-demand full game analysis with accuracy and blunder classification`

---

### - [x] Таск 4.2. Шкала оценки (Evaluation Bar), график перевеса и стрелки на доске в `GameViewer.tsx`

* **Ветка Git:** `feature/game-viewer-eval-bar-and-arrows`
* **Что сделано:**
    1. В `frontend/src/components/GameViewer.tsx` добавлена вертикальная шкала оценки `EvalBar`.
    2. Добавлена кнопка «Компьютерный анализ», сводка точности/зевков и интерактивный график перевеса `AreaChart`
       (`recharts`).
    3. Добавлено рисование тактических стрелок и выделение полей правой кнопкой мыши (SVG-оверлей).
* **Тестирование:**

  cd frontend && npm run lint && npm run test && npm run build && cd ..

* **Коммит:** `feat: add Evaluation Bar, Recharts advantage graph, and right-click arrows to GameViewer`

---

## СПРИНТ 5. Прагматичный Античит на базе уже собираемой телеметрии (ОЧЕРЕДЬ РАЗРАБОТКИ ⏳)

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

  git checkout dev && git pull origin dev && git checkout -b feature/telemetry-anticheat-service

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

      python -m pytest tests/test_anticheat.py -v

* **Коммит:** `feat: implement deterministic anti-cheat telemetry analyzer and trust factor updates`

---

## СПРИНТ 6. Оптимизация Архива Чемпионов и финальная полировка (Production Ready ⏳)

### - [ ] Таск 6.1. Оптимизация SQL-запросов истории партий и сидера Чемпионов (`src/api/profile.py` и `src/db/seed.py`)

* **Техническая причина:** В `src/api/profile.py` функция `get_user_games` сейчас выгружает все партии игрока из БД в
  память Python (`games_result.all()`) и на каждый HTTP-запрос регулярными выражениями парсит `game.pgn`, чтобы достать
  `Result`, `Date`, `Site`, `ECO`.
* **Ветка Git:** `perf/optimize-games-query-and-seeder`
* **Команда старта:**

  git checkout dev && git pull origin dev && git checkout -b perf/optimize-games-query-and-seeder

* **Что сделать:**
    1. Добавить в модель `Game` (`src/models/game.py`) индексированные колонки `pgn_date` (`String(20)`), `site`
       (`String(100)`), `eco` (`String(10)`) и выполнить миграцию Alembic:

  alembic revision --autogenerate -m "add_metadata_columns_to_games"
  alembic upgrade head

    2. Обновить `src/db/seed.py` и `state_manager.finish_game`, чтобы эти поля заполнялись один раз при сохранении
       партии в БД.
    3. В `src/api/profile.py` перевести пагинацию и сортировку `get_user_games` на чистый SQL (`ORDER BY`, `LIMIT`,
       `OFFSET` на уровне PostgreSQL) без загрузки всех PGN в оперативную память.
* **Тестирование:**

  python -m pytest -v

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

  git checkout dev && git pull origin dev && git checkout -b feature/leaderboard-and-touch-support

* **Что сделать:**
    1. Создать компонент `frontend/src/components/Leaderboard.tsx` (и роут `/leaderboard` в `App.tsx`), подключив его к
       `GET /api/v1/profile/leaderboard`.
    2. В `Chessboard.tsx` и `GameViewer.tsx` адаптировать `boardSize` под ширину мобильного экрана
       (`Math.min(boardSize, window.innerWidth - 24)`) и заменить мышиные события перетаскивания на универсальные
       `Pointer Events`.
* **Тестирование:**

  cd frontend && npm run lint && npm run test && npm run build && cd ..

* **Коммит:** `feat: add Leaderboard page and responsive touch/pointer support for chessboard`

---

### - [ ] Таск 6.3. Финальный релиз в ветку `master`

Когда все 6 спринтов пройдены, протестированы и влиты в `dev`, выпускаем чистый стабильный релиз:

    python -m flake8 src tests scripts --count --select=E9,F63,F7,F82 --show-source --statistics
    python -m pytest -v
    cd frontend && npm run lint && npm run test && npm run build && cd ..

    git checkout master
    git pull origin master
    git merge --no-ff dev -m "Release v1.0: Full PvP Chess Portal with Stockfish Analysis and Anti-Cheat"
    git push origin master
    git checkout dev