<!-- --- FILE: WORKFLOW.md --- -->

# Регламент разработки и Git-процессов (Michess Workflow)

Пошаговая шпаргалка для работы над каждой новой задачей в проекте.

---

## 1. Схема веток проекта

1. `master` — **Релизная ветка (Production).**
    * Здесь лежит только проверенный и полностью рабочий код.
    * Напрямую в `master` код никогда не пишем. Обновляем его только слиянием из `dev`.

2. `dev` — **Основная ветка разработки (Integration).**
    * База, в которую сливаются все готовые фичи и исправления.
    * Все новые ветки создаются от `dev` и после завершения вливаются обратно в `dev`.

3. Рабочие ветки (`feature/...`, `fix/...`, `chore/...`, `perf/...`) — **Ветки под конкретную задачу.**
    * `feature/название` — новая функциональность или доработка UI (например, `feature/board-layout`);
    * `fix/название` — исправление бага (например, `fix/timer-sync`);
    * `chore/название` — настройка инфраструктуры, тестов, документации, CI/CD;
    * `perf/название` — оптимизация производительности и SQL-запросов.

---

## 2. Пошаговый алгоритм работы над новой фичей (От и До)

### Шаг 1. Создание ветки перед началом работы

Всегда начинай новую задачу в корневой папке проекта `michess` с переключения на `dev` и создания новой рабочей ветки:

    git checkout dev
    git pull origin dev
    git checkout -b feature/название-задачи

*(Если ты забыл создать ветку и уже начал менять файлы прямо в `dev` — просто выполни
`git checkout -b feature/название-задачи`, и все незакоммиченные изменения автоматически переедут в новую ветку).*

---

### Шаг 2. Написание кода и правило миграций БД (Alembic)

ВАЖНОЕ ПРАВИЛО ПО БАЗЕ ДАННЫХ:

* Если ты менял **только фронтенд** (`frontend/...`), стили, WebSocket-логику или сервисы Python без изменения таблиц
  БД — **миграции Alembic делать НЕ НУЖНО**.
* Миграция создается **ТОЛЬКО** тогда, когда ты изменил или добавил колонки/таблицы в папке `src/models/`. В этом случае
  выполни:

  alembic revision --autogenerate -m "описание_изменений_моделей"
  alembic upgrade head

---

### Шаг 3. Локальная проверка перед коммитом

1. Если менялся Python-код (из корня проекта):

   pip install -r requirements-dev.txt   # один раз: ruff, mypy, pytest-cov
   ruff check .                          # линтер (правила — pyproject.toml), любое замечание роняет CI
   mypy                                  # проверка типов src/
   python -m pytest --cov                # тесты и покрытие (порог — pyproject.toml)

   Интеграционные тесты (`tests/integration`) запускаются только при заданных `TEST_DATABASE_URL` и
   `TEST_REDIS_URL` и **удаляют все таблицы** в указанной базе — используйте отдельную базу, не рабочую:

   docker exec michess-db-1 psql -U michess_user -d michess_db -c "CREATE DATABASE michess_test"
   $env:TEST_DATABASE_URL = "postgresql+asyncpg://michess_user:michess_password@localhost:15432/michess_test"
   $env:TEST_REDIS_URL = "redis://localhost:6379/15"
   python -m pytest tests/integration

2. Если менялся React/TypeScript-код (фронтенд):

   cd frontend
   npm run lint
   npm run test
   npm run build
   cd ..

---

### Шаг 4. Коммит изменений в рабочую ветку

Убедись по `git status`, что в список не попали временные файлы, и зафиксируй изменения:

    git status
    git add .
    git commit -m "feat: краткое описание сделанной задачи"

Префиксы коммитов:

* `feat:` — новая фича или улучшение интерфейса
* `fix:` — исправление ошибки
* `refactor:` — рефакторинг кода
* `perf:` — ускорение работы и оптимизация запросов
* `chore:` — инфраструктура, конфиги, зависимости
* `docs:` — документация (`README.md`, `QUICKSTART.md`, `WORKFLOW.md`, `ToDo.md`)

---

### Шаг 5. Слияние готовой задачи в `dev` и отправка на GitHub

Когда задача проверена в браузере и тесты проходят:

    git checkout dev
    git merge --no-ff feature/название-задачи -m "Merge feature/название-задачи into dev"
    git push origin dev
    git branch -d feature/название-задачи

После `git push origin dev` на GitHub во вкладке **Actions** автоматически запустится пайплайн `Michess CI`, который
проверит бэкенд и фронтенд в облаке.

---

### Шаг 6. Выпуск стабильного релиза в `master`

Выполняется, когда в `dev` завершен логический этап (или спринт) и всё стабильно работает:

    git checkout master
    git pull origin master
    git merge --no-ff dev -m "Release: merge stable dev into master"
    git push origin master
    git checkout dev

*(Последняя команда `git checkout dev` обязательна, чтобы никогда не оставаться в ветке `master`).*