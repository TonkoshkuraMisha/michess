<!-- --- FILE: QUICKSTART.md --- -->

# Быстрый старт и восстановление regence на новом хосте

## 1. Установка с нуля (Холодный старт на новом ПК)

### Шаг 1. Клонирование и переменные окружения

    git clone https://github.com/TonkoshkuraMisha/regence.git regence
    cd regence
    git checkout dev

    Copy-Item .env.example .env -ErrorAction SilentlyContinue
    Copy-Item frontend/.env.example frontend/.env -ErrorAction SilentlyContinue

### Шаг 2. Поднятие базы данных и Redis

    docker compose up -d db redis
    docker compose ps

### Шаг 3. Настройка Python-окружения, миграций и движка Stockfish (Бэкенд)

    uv sync                       # создаёт .venv: Python 3.14 из .python-version, пакеты строго по uv.lock
    .\.venv\Scripts\Activate.ps1
    python scripts/setup_stockfish.py     # движок Stockfish в bin/ (без него работают все тесты, но не боты и разбор)
    python scripts/download_champions.py  # портреты шахматистов со свободной лицензией (Викисклад)
    alembic upgrade head                  # схема базы
    python -m scripts.import_puzzles      # задачи из data/puzzles/ в базу (повторный запуск безопасен)
    python -m src.db.seed                 # по желанию: архив партий чемпионов мира

### Шаг 4. Установка пакетов Фронтенда

    cd frontend
    npm install
    cd ..

---

## 2. Ежедневный запуск

### Вариант А — Автоматический (одной командой из корня на любом ПК)

    .\start_dev.ps1

Для остановки фоновых серверов:

    Get-Job | Stop-Job; Get-Job | Remove-Job

### Вариант Б — Ручной (в 4 терминалах)

**Терминал 1 — Инфраструктура (Docker):**

    docker compose up -d db redis

**Терминал 2 — Бэкенд (FastAPI):**

    .\.venv\Scripts\Activate.ps1
    alembic upgrade head
    python -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload

**Терминал 3 — Celery-воркер (разбор партий и партии ботов в турнирах):**

    .\.venv\Scripts\Activate.ps1
    celery -A src.worker.celery_app worker --loglevel=INFO --pool=solo -Q analysis,simulation

`--pool=solo` нужен на Windows: пул prefork у Celery там не работает. Очередей две: `analysis` (разбор партий,
индекс позиций, напоминания) и `simulation` (партии ботов между собой) — в разработке их слушает один воркер.

Плановые задачи (напоминания о разминке и о начале арены, самоигра ботов) запускает отдельный процесс; в обычной
разработке он не нужен, `start_dev.ps1` его не поднимает:

    celery -A src.worker.celery_app beat --loglevel=INFO

**Терминал 4 — Фронтенд (Vite):**

    cd frontend
    npm run dev

* **Фронтенд:** [http://127.0.0.1:3000](http://127.0.0.1:3000)
* **Swagger API:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## Продакшен

Развёртывание в Docker (nginx, API, Celery, PostgreSQL, Redis) — см. [DEPLOY.md](DEPLOY.md).

---

## 3. Проверка здоровья проекта (Линтеры и Тесты)

**Бэкенд:**

    .\.venv\Scripts\Activate.ps1
    uv sync                               # dev-инструменты (ruff, mypy, pytest-cov) ставятся по умолчанию
    ruff check .                          # линтер (правила — pyproject.toml)
    mypy                                  # проверка типов src/
    python -m pytest --cov                # тесты и покрытие (порог — pyproject.toml)

Тестам не нужны ни PostgreSQL, ни Redis, ни Stockfish: база — SQLite в памяти, Redis и движок подменены. Один
раздел: `python -m pytest tests/test_arena.py -q`. Какой тест какой раздел проверяет — `docs/ARCHITECTURE.md`, §4.

**Фронтенд:**

    cd frontend
    npm run lint
    npm run test
    npm run build
    cd ..