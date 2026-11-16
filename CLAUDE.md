# Архитектура и правила проекта michess

## 0. Протокол сессии (экономия токенов — соблюдать всегда)
**Старт сессии:**
1. Прочитай ТОЛЬКО первые ~40 строк `ToDo.md` (блок «▶ Сейчас»). Весь `ToDo.md` целиком не читай, если не попросили.
2. Если нужна общая картина — `python project_status.py` (не перечитывай модули ради обзора).
3. Читай сразу файлы из карты модулей (раздел 3). Большие файлы — нужным диапазоном строк, а не целиком.
4. Для широкого поиска по многим файлам («где используется X», «найди все места Y») — используй субагента Explore: в основной контекст должен вернуться вывод, а не содержимое файлов.

**Во время работы:**
- Не перечитывай файл, который уже читал в этой сессии, если он не менялся.
- Не выводи файлы целиком в ответ; показывай только изменённые фрагменты.
- Тесты: сначала точечно (нужный файл/тест), полный прогон — только перед коммитом.
- Не правь этот `CLAUDE.md` посреди сессии без просьбы (сбрасывает кэш промпта).

**Завершение задачи (обязательно перед /clear):**
1. Перезапиши блок «▶ Сейчас» в начале `ToDo.md` (≤ 15 строк, шаблон ниже).
2. Перенеси итог задачи одной строкой в «Сделано» соответствующего раздела `ToDo.md`.
3. Коммит с понятным сообщением.


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
  - Playwright — только по явной просьбе.

## 2. Жёсткие инварианты проекта (Правила Части II ToDo.md)
1. **Три языка (en / uk / ru):** НИ ОДНОЙ пользовательской строки (включая кириллицу) в коде сервера или JSX. Сервер отдаёт коды (`src/core/errors.py`, ключи `coach.*`, `botComments.*`, коды тем), текст собирает клиент из `frontend/src/i18n/messages/{en,uk,ru}.ts`. Ключи и параметры во всех трёх каталогах обязаны совпадать.
2. **Честная игра:** эндпоинты с оценкой/ходом движка (`/analysis/*`, `/bots/move`, `/bots/custom-move`, `/bots/draw-offer`, `/chess960/move`, `/chess960/bot-move`, `/repertoires/{id}/opponent`) закрыты зависимостью `forbid_engine_help_during_game` (`src/api/fair_play.py`) во время PvP-партии и отмечаются в сессиях лестницы/турнира (`src/services/ladder.py`, области `ladder` и `tournament`).
3. **Бюджет движка:** Stockfish вызывается ТОЛЬКО через `get_engine_pool(path).acquire()` (`src/services/engine_pool.py`). В тестах CI бинарник не используется — тестировать на моках или статическом анализаторе с фиксированным seed.
4. **База данных:** миграции Alembic (`alembic revision --autogenerate`) создавать ТОЛЬКО при изменении `src/models/`. В WebSocket (`src/api/websockets.py`) использовать короткие сессии на каждое действие (`ActionContext.release_db` перед отправкой в сеть).
5. **Чистота контента:** никаких упоминаний названий чужих коммерческих программ 2000-х, их персоналий или копирования текстов. Любой ассет — только со свободной лицензией и записью в `ATTRIBUTION.md`.

## 3. Карта ключевых модулей (читай сразу нужный файл, не делай лишний поиск)
- **Состояние и план:** `python project_status.py` (сводка) и `ToDo.md` (блок «▶ Сейчас» в начале + разделы «Сделано/Осталось»).
- **Боты и стиль:** `src/services/bots/base.py` (`HistoricalBot`, окно силы вокруг `strength_reference_move`), `style.py` (правила `Rule/Group/FirstOf`), `personality.py` (`BotPersonalityConfig`, `ERROR_RATE_CURVE`), `archetypes.py`, `calibration.py` + `calibration.json`.
- **Наставник и тактика:** `src/services/mentor_service.py` (детектор 20 мотивов + SEE), `positional.py` (позиционные признаки), `coach.py` (сборка шаблонов и стрелок), `move_check.py` (проверка хода + кэш в Redis), `themes.py` (реестр 125 тем в 12 разделах A–L, цель приёма `goal`).
- **Задачи и тренажёры:** `src/services/puzzles.py`, `personal_puzzles.py`, `defense_drills.py`, `drill_generator.py`, `generated_drills.py`, `mate_patterns.py`.
- **Турниры и лестница:** `src/services/tournaments.py`, `tournament_rules.py`, `tournament_simulation.py` (Celery очередь `simulation`), `ladder.py`.
- **PvP и WebSocket:** `src/api/websockets.py`, `src/services/game_state.py` (атомарные ходы в Redis, `game_deadlines`, сверка `reconcile_unfinished_games`), `matchmaker.py`, `connection_manager.py`.
- **Фронтенд — ядро доски:** `frontend/src/components/Chessboard.tsx`, хуки в `chessboard/hooks/` (`useClock.ts`, `usePremoves.ts`, `useBotGame.ts`, `useCoachMode.ts`, `useGameSocket.ts`), `chessboard/annotations.tsx`, `chessboard/AuxBoard.tsx`, `GameViewer.tsx`.
- **Библиотека, курс, репертуар:** `src/services/library.py` (импорт PGN, `repair_text`, `ends_in_mate`), `pawn_structures.py`, `cbh_reader.py`, `structure_quiz.py`, `miniatures.py`, `repertoire*.py`; фронтенд `content/supercourse.ts`, `content/mustKnow.ts`, `components/learn/SupercoursePage.tsx`, `components/library/`, `components/repertoire/`.
- **Фронтенд — разделы:** `components/puzzles/` (`PuzzlesPage.tsx`, `PuzzleBoard.tsx`, `DefenseTrainer.tsx`, `GeneratedDrills.tsx`, `TrainingPanel.tsx`, `SolutionReplay.tsx`), `components/learn/` (`LearnPage.tsx`, `LessonPlayer.tsx`), `components/tournaments/`, `components/xray/` + `services/xray/xrayUtils.ts`.
