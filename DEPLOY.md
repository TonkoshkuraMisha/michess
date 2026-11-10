<!-- --- FILE: DEPLOY.md --- -->

# Развёртывание michess (продакшен)

Стек поднимается одной командой через `docker-compose.prod.yml`:

| Сервис    | Что делает                                                        | Наружу       |
|-----------|-------------------------------------------------------------------|--------------|
| `web`     | nginx: статика фронтенда, прокси `/api/` и WebSocket, CSP          | порт 80      |
| `api`     | FastAPI (uvicorn, `WEB_CONCURRENCY` процессов)                     | —            |
| `worker`  | Celery: фоновый анализ завершённых партий (Stockfish)              | —            |
| `migrate` | одноразово применяет миграции Alembic перед стартом api и worker  | —            |
| `db`      | PostgreSQL 16                                                      | —            |
| `redis`   | Redis 7.4 с AOF (состояние партий, очереди, лимиты, брокер Celery) | —            |

## 1. Настройка

    cp .env.example .env

Обязательно поменять в `.env`:

- `SECRET_KEY` — случайная строка не короче 32 символов. Со слабым ключом API в продакшене
  **не стартует** (по нему подписываются токены всех пользователей):

      python -c "import secrets; print(secrets.token_urlsafe(48))"

- `POSTGRES_PASSWORD` — свой пароль БД.

`ENVIRONMENT=production`, адреса БД и Redis задаёт сам `docker-compose.prod.yml`.

## 2. Запуск

    docker compose -f docker-compose.prod.yml up -d --build
    docker compose -f docker-compose.prod.yml ps
    curl http://localhost/health      # {"status": "healthy", "checks": {...}}

Загрузка архива партий чемпионов мира (однократно, по желанию):

    docker compose -f docker-compose.prod.yml exec api python -m src.db.seed

## 3. Обновление

    git pull
    docker compose -f docker-compose.prod.yml up -d --build

Миграции применяются автоматически сервисом `migrate` до перезапуска `api` и `worker`.

> Релиз со спринта 7 меняет формат токенов: все пользователи один раз войдут заново.

## 4. HTTPS

nginx в образе `web` слушает только HTTP. TLS завершается снаружи — балансировщиком облака
или отдельным прокси (Caddy, Traefik) перед портом `HTTP_PORT`. Прокси должен передавать
`Upgrade`/`Connection` для WebSocket (`/api/v1/ws/`). Если TLS завершается прямо в nginx,
добавьте `listen 443 ssl` в `frontend/nginx.conf` и включите `Strict-Transport-Security`
в `frontend/security_headers.inc`.

Внешний прокси должен подменять, а не дописывать `X-Forwarded-For`: лимиты попыток входа
и запросов к движку считаются по IP клиента.

## 5. Что важно знать

- **Наружу открыт только `web`.** API доверяет `X-Forwarded-For` от любого адреса внутренней
  сети compose (`FORWARDED_ALLOW_IPS=*`) — это безопасно, пока порт `api` не опубликован.
- **Несколько процессов API** поддерживаются: присутствие, зрители, рассылка событий и цикл
  таймаутов (с выбором лидера) работают через Redis.
- **Мониторинг:** `GET /health` возвращает 503, если недоступна БД или Redis.
- **Документация API** (`/docs`) в продакшене отключена.
- **Celery-воркер** обязателен для фонового анализа партий; без него анализ всё равно
  считается по кнопке на странице партии.
