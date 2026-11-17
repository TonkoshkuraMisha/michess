# Архитектура и правила проекта michess

## 0. Протокол сессии (экономия токенов — соблюдать всегда)
**Старт сессии:**
1. Прочитай ТОЛЬКО первые ~40 строк `ToDo.md` (блок «▶ Сейчас»). Весь `ToDo.md` целиком не читай, если не попросили.
2. Если нужна общая картина — `python project_status.py` и `docs/ARCHITECTURE.md` (разделы сайта → файлы → данные
   → тесты); не перечитывай модули ради обзора.
3. Читай сразу файлы из карты модулей (раздел 3). Большие файлы — нужным диапазоном строк, а не целиком.
4. Для широкого поиска по многим файлам («где используется X», «найди все места Y») — используй субагента Explore: в основной контекст должен вернуться вывод, а не содержимое файлов.

**Во время работы:**
- Не перечитывай файл, который уже читал в этой сессии, если он не менялся.
- Не выводи файлы целиком в ответ; показывай только изменённые фрагменты.
- Тесты: сначала точечно (нужный файл/тест), полный прогон — только перед коммитом.
- Не правь этот `CLAUDE.md` посреди сессии без просьбы (сбрасывает кэш промпта).

**Завершение задачи (обязательно перед /clear):**
1. Перезапиши блок «▶ Сейчас» в начале `ToDo.md` (≤ 15 строк).
2. Перенеси итог задачи одной записью в «Сделано» соответствующего раздела `ToDo.md`.
3. Обнови описания: докстринг изменённого модуля, а если поменялось поведение раздела, настройка или состав
   модулей — `docs/ARCHITECTURE.md`, `DEPLOY.md` / `.env.example` и карту модулей ниже (правило 6).
4. Коммит с понятным сообщением; дальше — запрос на слияние в `dev`, зелёный CI, слияние (`WORKFLOW.md`, шаг 5).


## Compact instructions
При /compact или авто-сжатии сохраняй: текущую цель задачи, список изменённых файлов, принятые решения и их причины, последние ошибки тестов (только текст ошибки) и следующий шаг. Выбрасывай: полные выводы тестов и команд, содержимое прочитанных файлов, промежуточные диффы, отвергнутые варианты.

## 1. Стек и запуск проверок (экономь токены вывода!)
- Backend: Python 3.14, FastAPI, SQLAlchemy 2.0 (asyncpg), Redis 7.4, Celery, python-chess, Stockfish 19.
- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS v4, chess.js, Vitest, Playwright.
- Команды проверки (ВСЕГДА в тихом режиме, чтобы не засорять контекст):
  - Окружение: `uv sync` (Python 3.14 из `.python-version`, пакеты строго по `uv.lock`); команды ниже запускать через `uv run`.
  - `uv run ruff check . --quiet`
  - `uv run mypy` (выводи только ошибки; при длинном выводе — `mypy | tail -30`)
  - `uv run python -m pytest -q --tb=short --no-header` (или точечно: `uv run pytest tests/test_xxx.py -q --tb=short`)
  - `cd frontend && npm run lint && npx vitest run --reporter=dot`
  - Перед отправкой ветки с правками клиента — `npm run build`: ошибки типов ловит только он.
  - Playwright локально — только по явной просьбе (в CI он идёт на собранных образах).

## 2. Жёсткие инварианты проекта (Правила Части II ToDo.md)
1. **Три языка (en / uk / ru):** НИ ОДНОЙ пользовательской строки (включая кириллицу) в коде сервера или JSX. Сервер отдаёт коды (`src/core/errors.py`, ключи `coach.*`, `botComments.*`, коды тем), текст собирает клиент из `frontend/src/i18n/messages/{en,uk,ru}.ts`. Ключи и параметры во всех трёх каталогах обязаны совпадать.
2. **Честная игра:** эндпоинты с оценкой/ходом движка (`/analysis/*`, `/bots/move`, `/bots/custom-move`, `/bots/draw-offer`, `/chess960/move`, `/chess960/bot-move`, `/repertoires/{id}/opponent`) закрыты зависимостью `forbid_engine_help_during_game` (`src/api/fair_play.py`) во время PvP-партии и отмечаются в сессиях лестницы/турнира (`src/services/ladder.py`, области `ladder` и `tournament`).
3. **Бюджет движка:** Stockfish вызывается ТОЛЬКО через `get_engine_pool(path).acquire()` (`src/services/engine_pool.py`). В тестах CI бинарник не используется — тестировать на моках или статическом анализаторе с фиксированным seed.
4. **База данных:** миграции Alembic создавать ТОЛЬКО при изменении `src/models/` — `alembic revision --autogenerate` или вручную по образцу соседних (CI применяет их на пустой базе и сверяет с моделями: `alembic check`); голова миграций одна. В WebSocket (`src/api/websockets.py`) использовать короткие сессии на каждое действие (`ActionContext.release_db` перед отправкой в сеть).
5. **Чистота контента:** никаких упоминаний названий чужих коммерческих программ 2000-х, их персоналий или копирования текстов. Любой ассет — только со свободной лицензией и записью в `ATTRIBUTION.md`.
6. **Описания:** владелец проверяет проект по документации и комментариям. У каждого модуля — докстринг (в файлах клиента — комментарий в начале): что делает, по каким правилам и откуда берёт данные (таблица, файл, настройка, внешний источник). Изменил поведение — исправь описание в том же запросе на слияние. Комментарии — по-русски; строк для игрока в них быть не может, но правило 1 действует и на сообщения `assert` и исключений.

## 3. Карта ключевых модулей (читай сразу нужный файл, не делай лишний поиск)
- **Состояние и план:** `python project_status.py` (сводка), `ToDo.md` (блок «▶ Сейчас» в начале + разделы «Сделано/Осталось»), `docs/ARCHITECTURE.md` (устройство по разделам).
- **Боты и стиль:** `src/services/bots/base.py` (`HistoricalBot`, окно силы вокруг `strength_reference_move`), `style.py` (правила `Rule/Group/FirstOf`), `personality.py` (`BotPersonalityConfig`, `ERROR_RATE_CURVE`), `archetypes.py`, `calibration.py` + `calibration.json`.
- **Наставник и тактика:** `src/services/mentor_service.py` (детектор 20 мотивов + SEE), `positional.py` (позиционные признаки), `coach.py` (сборка шаблонов и стрелок), `move_check.py` (проверка хода + кэш в Redis), `themes.py` (реестр 125 тем в 12 разделах A–L, цель приёма `goal`).
- **Задачи и тренажёры:** `src/services/puzzles.py`, `personal_puzzles.py`, `defense_drills.py`, `drill_generator.py`, `generated_drills.py`, `mate_patterns.py`.
- **Турниры и лестница:** `src/services/tournaments.py`, `tournament_rules.py`, `tournament_simulation.py` (Celery очередь `simulation`), `tournament_career.py`, `time_machine.py`, `ladder.py`.
- **Арены и конференции:** `src/services/arena.py` (правила, очки, берсерк, напоминания), `arena_schedule.py` (расписание по конференциям), `conferences.py` (страны, зачёт, Кубок), `src/api/arenas.py`, `src/api/conferences.py`; фронтенд `components/arena/`, `services/arenas.ts`, `services/conferences.ts`. Замысел — `docs/research/arenas.md`.
- **Общение:** `src/services/notifications.py`, `direct_messages.py`, `feed.py`, `attachments.py`, `civility.py`, `moderation.py`, `league.py` (команды), `study_room.py`; фронтенд `components/social/`.
- **Фоновые задачи:** `src/worker/tasks.py`, `src/worker/celery_app.py` (очереди `analysis` / `simulation`, расписание beat), постановка из API — `src/services/task_dispatch.py`.
- **PvP и WebSocket:** `src/api/websockets.py`, `src/services/game_state.py` (атомарные ходы в Redis, часы и квота лага, `game_deadlines`, сверка `reconcile_unfinished_games`), `matchmaker.py`, `connection_manager.py`, `rating.py`, `anticheat.py`.
- **Фронтенд — ядро доски:** `frontend/src/components/Chessboard.tsx`, хуки в `chessboard/hooks/` (`useClock.ts`, `usePremoves.ts`, `useBotGame.ts`, `useCoachMode.ts`, `useGameSocket.ts`), `chessboard/annotations.tsx`, `chessboard/AuxBoard.tsx`, `GameViewer.tsx`.
- **Библиотека, курс, репертуар:** `src/services/library.py` (импорт PGN, `repair_text`, `ends_in_mate`), `pawn_structures.py`, `cbh_reader.py`, `structure_quiz.py`, `miniatures.py`, `repertoire*.py`; фронтенд `content/supercourse.ts`, `content/mustKnow.ts`, `components/learn/SupercoursePage.tsx`, `components/library/`, `components/repertoire/`.
- **Фронтенд — разделы:** `components/puzzles/` (`PuzzlesPage.tsx`, `PuzzleBoard.tsx`, `DefenseTrainer.tsx`, `GeneratedDrills.tsx`, `TrainingPanel.tsx`, `SolutionReplay.tsx`), `components/learn/` (`LearnPage.tsx`, `LessonPlayer.tsx`), `components/tournaments/`, `components/xray/` + `services/xray/xrayUtils.ts`.
