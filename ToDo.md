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

### - [x] Таск 1.2. Вынос API/WS URL в переменные окружения фронтенда (`.env`)

---

## СПРИНТ 2. Доведение ядра PvP-геймплея до профессионального стандарта (ВЫПОЛНЕНО ✅)

### - [x] Таск 2.1. Диалог выбора фигуры при превращении пешки (Pawn Promotion UI)

### - [x] Таск 2.2. Система предходов (Premoves) для Bullet и Blitz

### - [x] Таск 2.3. Авто-отмена партии при неявке на 1-м ходу (Abort Game) и защита от дисконнекта

---

## СПРИНТ 3. Социальный PvP: Реванши, Приватные вызовы по ссылке, Зрители и Чат (ВЫПОЛНЕНО ✅)

### - [x] Таск 3.1. Система мгновенного реванша («Реванш» / Rematch) с переменой цвета

### - [x] Таск 3.2. Приватные вызовы по прямой ссылке (Игра с другом / учеником)

### - [x] Таск 3.3. Режим зрителя (Spectator Mode) и вкладка «Текущие партии (Live)»

### - [x] Таск 3.4. Компактный игровой чат и быстрые реплики сопернику

---

## СПРИНТ 4. Умная интеграция Stockfish (Анализ по запросу и Доска анализа) (ВЫПОЛНЕНО ✅)

### - [x] Таск 4.1. Разбор всей партии движком по кнопке (Accuracy, Blunders, Evaluation Graph)

### - [x] Таск 4.2. Шкала оценки (Evaluation Bar), график перевеса и стрелки на доске в `GameViewer.tsx`

---

## СПРИНТ 5. Прагматичный Античит на базе уже собираемой телеметрии (ВЫПОЛНЕНО ✅)

### - [x] Таск 5.1. Детектор аномалий поведения (Timing Variance + Tab-Switch)

* Создан сервис `src/services/anticheat.py` с идемпотентной функцией `evaluate_game_telemetry(db, game_id)`.
* Подключён автоматический расчёт штрафов `trust_factor` в `state_manager.finish_game` и отображение бейджа репутации в
  `Profile.tsx`.
* Добавлены тесты в `tests/test_anticheat.py` и `tests/test_audit_fixes.py`.

---

## СПРИНТ 6. Оптимизация Архива Чемпионов и финальная полировка (ВЫПОЛНЕНО ✅)

### - [x] Таск 6.1. Оптимизация SQL-запросов истории партий и сидера Чемпионов (`src/api/profile.py` и `src/db/seed.py`)

* Добавлены индексированные колонки `pgn_date`, `site`, `eco` в `Game` и миграция
  `d9f4a1b2c3e4_add_metadata_columns_to_games.py`.
* Пагинация и сортировка `get_user_games` переведены на чистый SQL (`COUNT`, `ORDER BY`, `LIMIT`, `OFFSET`).

### - [x] Таск 6.2. Touch-адаптация доски для планшетов и смартфонов + таблица лидеров (`Leaderboard`)

* Создан компонент `frontend/src/components/Leaderboard.tsx` и роут `/leaderboard` в `App.tsx`.
* В `Chessboard.tsx` и `GameViewer.tsx` внедрены `Pointer Events` (`onPointerDown`, `pointermove`, `pointerup`) и
  адаптивный размер доски для мобильных экранов.

### - [ ] Таск 6.3. Финальный релиз в ветку `master`

    python -m flake8 src tests scripts --count --select=E9,F63,F7,F82 --show-source --statistics
    python -m pytest -v
    cd frontend && npm run lint && npm run test && npm run build && cd ..

    git checkout master
    git pull origin master
    git merge --no-ff dev -m "Release v1.0: Full PvP Chess Portal with Stockfish Analysis and Anti-Cheat"
    git push origin master
    git checkout dev