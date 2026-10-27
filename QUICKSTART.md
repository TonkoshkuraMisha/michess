# Быстрый старт и восстановление michess на новом хосте

## 1. Установка с нуля (Холодный старт на новом ПК)

### Шаг 1. Клонирование и переменные окружения

```powershell
git clone [https://github.com/TonkoshkuraMisha/michess.git](https://github.com/TonkoshkuraMisha/michess.git) michess
cd michess
git checkout dev

Copy-Item .env.example .env -ErrorAction SilentlyContinue
Copy-Item frontend/.env.example frontend/.env -ErrorAction SilentlyContinue
```

### Шаг 2. Поднятие базы данных и Redis

```powershell
docker compose up -d db redis
docker compose ps
```

### Шаг 3. Настройка Python-окружения (Бэкенд)

```powershell
python -m venv michess_env
.\michess_env\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
alembic upgrade head
```

### Шаг 4. Установка пакетов Фронтенда

```powershell
cd frontend
npm install
cd ..
```

---

## 2. Ежедневный запуск

### Вариант А — Автоматический (одной командой из корня)

```powershell
.\start_dev.ps1
```

### Вариант Б — Ручной (в 3 терминалах)

**Терминал 1 — Инфраструктура (Docker):**

```powershell
docker compose up -d db redis
```

**Терминал 2 — Бэкенд (FastAPI):**

```powershell
.\michess_env\Scripts\Activate.ps1
alembic upgrade head
python -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
```

**Терминал 3 — Фронтенд (Vite):**

```powershell
cd frontend
npm run dev
```

* **Фронтенд:** http://127.0.0.1:3000
* **Swagger API:** http://127.0.0.1:8000/docs

---

## 3. Проверка здоровья проекта (Линтеры и Тесты)

**Бэкенд:**

```powershell
.\michess_env\Scripts\Activate.ps1
python -m flake8 src tests --count --select=E9,F63,F7,F82 --show-source --statistics
python -m pytest -v
```

**Фронтенд:**

```powershell
cd frontend
npm run lint
npm run test
npm run build
cd ..
```