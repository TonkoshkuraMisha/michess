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
| `backup`  | `pg_dump` по расписанию в `BACKUP_DIR`, удаление старых копий       | —            |

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

## 5. Резервные копии

Сервис `backup` делает снимок БД сразу при старте и затем каждые `BACKUP_INTERVAL_HOURS` часов
(по умолчанию 24) в папку хоста `BACKUP_DIR` (`./backups`): `michess_YYYYmmdd_HHMMSS.dump`,
формат `pg_dump -Fc`. Снимки старше `BACKUP_KEEP_DAYS` дней (14) удаляются.

**Копируйте `BACKUP_DIR` за пределы сервера** (rsync, `rclone` в объектное хранилище): копия
на том же диске не переживёт потерю диска или сервера.

    # снимок прямо сейчас (например, перед обновлением с миграциями)
    docker compose -f docker-compose.prod.yml run --rm --no-deps backup once

    # проверка: последний снимок восстанавливается во временную базу и читается
    docker compose -f docker-compose.prod.yml run --rm --no-deps backup verify

Проверяйте восстановление регулярно (хотя бы раз в неделю, например cron-задачей с `verify`):
снимок, который не восстанавливается, обнаружится только в день аварии.

### Восстановление

    docker compose -f docker-compose.prod.yml stop api worker
    docker compose -f docker-compose.prod.yml run --rm --no-deps backup restore michess_20261111_094729.dump
    docker compose -f docker-compose.prod.yml up -d

`restore` заменяет содержимое рабочей базы одной транзакцией (при ошибке база остаётся как
была). Если снимок сделан на более старой версии схемы, сервис `migrate` догонит её при `up`.
Состояние идущих партий хранится в Redis (AOF) и снимком БД не покрывается.

## 6. Мониторинг

**Ошибки — Sentry.** Задайте в `.env` `SENTRY_DSN` (проект Python в Sentry или совместимом
GlitchTip) и перезапустите `api` и `worker`. В Sentry уходят необработанные исключения и всё, что
логируется как ошибка: сбои WS-действий, цикла таймаутов, фонового анализа. Cookie, заголовки
авторизации и IP не отправляются. `SENTRY_TRACES_SAMPLE_RATE` (например, `0.05`) включает
выборочную трассировку производительности.

**Метрики — Prometheus.** API отдаёт `GET /metrics` (сумма по всем процессам uvicorn). Наружу
путь не опубликован — nginx проксирует только `/api/` и `/health`; Prometheus должен быть в сети
compose (или опубликуйте порт `api` только на внутренний интерфейс):

    scrape_configs:
      - job_name: michess
        static_configs:
          - targets: ["api:8000"]

| Метрика                                    | Что показывает                                              |
|--------------------------------------------|-------------------------------------------------------------|
| `michess_ws_connections`                   | открытые WebSocket-соединения                               |
| `michess_ws_actions_total{action,outcome}` | WS-действия: `ok`, `ignored`, `rejected`, `error`, `rate_limited` |
| `michess_ws_action_seconds{action}`        | время обработки; `action="make_move"` — задержка хода       |
| `michess_db_pool_checked_out`              | занятые соединения пула БД (предел — `DB_POOL_SIZE + DB_MAX_OVERFLOW` на процесс) |
| `michess_http_requests_total`, `michess_http_request_seconds` | HTTP по шаблону маршрута и статусу    |
| `michess_games_finished_total{termination}`| завершённые партии                                          |
| `michess_timeout_check_failures_total`     | сбои проверки флагов и неявок (должен быть около нуля)      |

Стоит настроить оповещения: p95 `michess_ws_action_seconds{action="make_move"}` выше 0,5 с,
рост `michess_ws_actions_total{outcome="error"}` и `michess_timeout_check_failures_total`,
`michess_db_pool_checked_out` у предела пула, `/health` с кодом 503.

## 7. Что важно знать

- **Наружу открыт только `web`.** API доверяет `X-Forwarded-For` от любого адреса внутренней
  сети compose (`FORWARDED_ALLOW_IPS=*`) — это безопасно, пока порт `api` не опубликован.
- **Несколько процессов API** поддерживаются: присутствие, зрители, рассылка событий и цикл
  таймаутов (с выбором лидера) работают через Redis.
- **Мониторинг:** `GET /health` возвращает 503, если недоступна БД или Redis.
- **Документация API** (`/docs`) в продакшене отключена.
- **Celery-воркер** обязателен для фонового анализа партий; без него анализ всё равно
  считается по кнопке на странице партии.
