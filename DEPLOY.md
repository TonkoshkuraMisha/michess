<!-- --- FILE: DEPLOY.md --- -->

# Развёртывание michess (продакшен)

Стек поднимается одной командой через `docker-compose.prod.yml`:

| Сервис    | Что делает                                                        | Наружу       |
|-----------|-------------------------------------------------------------------|--------------|
| `web`     | nginx: статика фронтенда, прокси `/api/` и WebSocket, CSP          | порт 80      |
| `api`     | FastAPI (uvicorn, `WEB_CONCURRENCY` процессов)                     | —            |
| `worker`  | Celery, очередь `analysis`: фоновый анализ завершённых партий       | —            |
| `worker-simulation` | Celery, очередь `simulation`: партии ботов между собой в турнирах | — |
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
| `michess_engine_seconds_total{kind}`       | время, пока движки Stockfish заняты: `bot_move`, `analysis`, `coach`, `simulation`, `puzzles`, `other` |
| `michess_engine_acquire_wait_seconds{kind}`, `michess_engine_busy_total{kind}` | ожидание свободного движка и отказы «пул занят» |
| `michess_active_players_today`             | вошедшие игроки за сутки UTC (HyperLogLog в Redis)          |

Стоит настроить оповещения: p95 `michess_ws_action_seconds{action="make_move"}` выше 0,5 с,
рост `michess_ws_actions_total{outcome="error"}` и `michess_timeout_check_failures_total`,
`michess_db_pool_checked_out` у предела пула, `/health` с кодом 503.

**Бюджет движка (таск 23.3).** Процессор на активного игрока в день (в конце суток UTC):
`increase(michess_engine_seconds_total[1d]) / michess_active_players_today`, по видам работ — с `by (kind)`.
Счётчики пишет процесс, где работал движок: API (ходы ботов, анализ, наставник) отдаёт их на `/metrics`, а
Celery-воркеры (фоновый анализ, симуляция турниров) — только если у них общий с API `PROMETHEUS_MULTIPROC_DIR`
или свой экспортёр. Рост `michess_engine_busy_total` — сигнал добавить движков (`ENGINE_POOL_SIZE`) или воркеров.

**Эндшпильные таблицы (таск 14.4).** Решение владельца: в продакшене таблицы храним у себя. Поднять свой сервер
таблиц с API lichess (проект lila-tablebase: Syzygy 3–5 фигур ≈ 1 ГБ, плюс DTM-таблицы для счётчика «ходов до мата»)
и указать его адрес в `TABLEBASE_URL` (по умолчанию — открытый `https://tablebase.lichess.ovh/standard`, только для
разработки). Ответы кэшируются в Redis на 30 дней. Без доступа к таблицам тренажёр отвечает 503 `tablebase_unavailable`.

**Квоты бесплатного тарифа.** `FREE_TIER_LIMITS=true` включает дневные квоты на полный анализ партии
(`FREE_GAME_ANALYSES_PER_DAY`, по умолчанию 3) и на наставника — совет, подсказку, проверку хода
(`FREE_COACH_REQUESTS_PER_DAY`, 300). Засчитывается выполненная работа; сверх квоты — 429 `daily_limit_reached`.
По умолчанию выключено — включит тарифная модель (25.1). Ходы ботов, задачи и игра квот не имеют.

## 7. Нагрузочный тест

`scripts/loadtest/ws_load.py` разыгрывает N одновременных PvP-партий через nginx так же, как
настоящие игроки (тикет, WebSocket, приватный вызов, случайные легальные ходы, сдача), и меряет
задержку хода — от отправки `make_move` до получения своего `move_made`.

    # игроки loadtest_NNNN и их токены (регистрация через API ограничена по IP)
    docker compose -f docker-compose.prod.yml exec -T api         python -m scripts.loadtest.seed_users --count 400 > tokens.json
    python scripts/loadtest/ws_load.py --base-url http://localhost --tokens tokens.json --games 200
    # уборка: игроки и их партии
    docker compose -f docker-compose.prod.yml exec -T api python -m scripts.loadtest.seed_users --cleanup

Клиенту нужны `websockets`, `httpx` и `chess` (есть в `uv.lock`). Код выхода 1 при ошибках
или p95 выше `--max-p95-ms`. Запускайте на копии, а не на рабочем сервере: тест создаёт партии,
которые попадают в очередь анализа.

Результаты 11.11.2026 (один хост: 2 процесса uvicorn, PostgreSQL, Redis, воркер в Docker Desktop;
200 партий × 40 полуходов, «раздумье» 0,5–1,5 с — ~150 ходов/с, 400 WebSocket):

| Конфигурация                       | p50   | p95    | p99    | ошибки |
|------------------------------------|-------|--------|--------|--------|
| воркер анализа без предела CPU      | 17 мс | 233 мс | 668 мс | 0      |
| воркер остановлен                   | 16 мс | 72 мс  | 390 мс | 0      |
| воркер с `WORKER_CPUS=1.0`          | 18 мс | 136 мс | 499 мс | 0      |

В установившемся режиме p95 — 30–55 мс; хвост даёт синтетический всплеск — 200 партий стартуют
и завершаются почти одновременно. Stockfish воркера отнимает CPU у API, поэтому воркер ограничен
`WORKER_CPUS`; при росте нагрузки выносите его на отдельную машину.

## 8. Что важно знать

- **Наружу открыт только `web`.** API доверяет `X-Forwarded-For` от любого адреса внутренней
  сети compose (`FORWARDED_ALLOW_IPS=*`) — это безопасно, пока порт `api` не опубликован.
- **Несколько процессов API** поддерживаются: присутствие, зрители, рассылка событий и цикл
  таймаутов (с выбором лидера) работают через Redis.
- **Мониторинг:** `GET /health` возвращает 503, если недоступна БД или Redis.
- **Документация API** (`/docs`) в продакшене отключена.
- **Пересоздание API не требует перезапуска nginx:** адрес `api` перечитывается из DNS Docker
  каждые 10 с (`resolver` + `resolve` в `frontend/nginx.conf`).
- **Celery-воркер** обязателен для фонового анализа партий; без него анализ всё равно
  считается по кнопке на странице партии.
- **Воркер симуляции** (`worker-simulation`) обязателен для турниров: партии ботов между собой играет
  только он. Без него турнир застрянет на первом туре — партии ботов будут ждать в очереди `simulation`.
  Очереди разные, чтобы турнир на 8 (до 28 партий) не задерживал разбор партий игроков
  (`SIMULATION_CONCURRENCY`, `SIMULATION_CPUS`).
- **Сила ботов** показывается измеренной, если в образе есть `src/services/bots/calibration.json`. Его
  обновляет `scripts/calibrate_bots.py` (раздел 9) — после **любого** изменения выбора хода ботов.

## 8б. Вход: короткий токен и refresh-cookie

Access-токен живёт `ACCESS_TOKEN_EXPIRE_MINUTES` (15) и хранится только в памяти страницы; долгий вход — refresh-токен
в cookie `michess_refresh` (HttpOnly, SameSite=Strict, путь `/api/v1/auth`, `REFRESH_TOKEN_EXPIRE_DAYS` = 30), его хэш —
в Redis. Флаг Secure ставится при `ENVIRONMENT=production` (переопределяется `COOKIE_SECURE`): за nginx нужен HTTPS (раздел 4).
Если фронтенд и API на разных адресах, адрес фронтенда должен быть в `CORS_ORIGINS` — запросы идут с
`credentials: 'include'`. Сброс Redis выкидывает всех из долгих сессий: войти заново.

## 8а. Почта: подтверждение e-mail и сброс пароля

E-mail у игрока необязателен; привязывается по ссылке из письма и нужен, чтобы восстановить доступ, если пароль
забыт. Письма уходят по обычному SMTP — подходит любой провайдер транзакционной почты или свой сервер.

1. Выберите провайдера (на старте — Brevo: бесплатный объём хватает на бету, компания из ЕС; дальше — Amazon SES
   или Postmark) и подтвердите у него свой домен: добавьте в DNS выданные им записи **SPF** и **DKIM**, плюс
   **DMARC** (`v=DMARC1; p=quarantine; rua=mailto:…`). Без них письма попадают в спам.
2. В `.env`: `SMTP_HOST`, `SMTP_PORT` (обычно 587), `SMTP_USER`, `SMTP_PASSWORD` (SMTP-ключ провайдера),
   `SMTP_STARTTLS=true`, `MAIL_FROM` (адрес на подтверждённом домене), `PUBLIC_BASE_URL` (адрес сайта — из него
   собираются ссылки в письмах).
3. `docker compose -f docker-compose.prod.yml up -d` — API перечитает настройки. Проверка: в настройках привяжите
   свой адрес и откройте ссылку из письма.

Пока `SMTP_HOST` пуст, письма не отправляются, а пишутся в лог API (`docker compose logs api | grep mail`) —
так удобно в разработке. Провайдер становится обработчиком персональных данных — укажите его в политике
конфиденциальности (таск 23.1).

## 9. Служебные скрипты

| Скрипт | Что делает | Когда запускать |
|---|---|---|
| `scripts/calibrate_bots.py` | Матчи ботов с эталонами Stockfish (фиксированный `UCI_Elo`) и между собой, рейтинги всех ботов сразу с ±95 %; пишет `calibration.json` и лог в `scripts/calibration_runs/` | После изменения ботов, их стиля или силы; ~1 ч, нужен Stockfish |
| `scripts/calibrate_bots.py --from-log LOG` | Пересчёт рейтингов по логу прошлого прогона без партий; `--reuse-log` подмешивает партии ботов между собой | Поменялась только формула подбора или эталоны |
| `scripts/verify_lessons.py` | Сверяет ответы уроков школы со Stockfish: ответ не хуже лучшего хода, у него нет почти равного соперника, «неверные» ходы действительно хуже | После правки или добавления уроков (CI проверяет только легальность) |
| `scripts/style_metrics.py PGN` | Характер ботов в миттельшпиле по партиям калибровки (`calibrate_bots.py --pgn`): жертвы, размены, шахи, давление на короля, штурм | После изменения стиля исторических ботов |
| `scripts/product_metrics.py [--days N]` | Отчёт владельца из своей базы (таблица `product_events`, без сторонних трекеров): регистрации, активация (первая партия за 5 мин и за сутки), удержание D1/D7/D30, доходят ли игроки до задач, уроков, турниров | Раз в неделю на бете; в продакшене — `docker compose exec api python scripts/product_metrics.py` |
| `scripts/build_collections.py` | «Забавные подборки» архива для страницы «Просмотр» (таск 16.3): показатели всех архивных партий → `collection_entries` (заменяет целиком) | После миграции `60ae872759c7` и после пополнения архива; 27,6 тыс. партий ≈ 20 с на 8 процессах. В продакшене: `docker compose exec api python scripts/build_collections.py` |
| `scripts/build_position_index.py` | Индекс позиций (таск 16.1): первые 30 полуходов всех законченных партий → `position_stats`, `position_games`; повтор безопасен (флаг `games.positions_indexed`) | Один раз после миграции `79ba65cdf46e`, дальше партии индексирует задача Celery при завершении; 27,6 тыс. партий ≈ 5 мин, ≈ 180 МБ в базе. В продакшене: `docker compose exec api python scripts/build_position_index.py` |
| `scripts/build_guess_positions.py --games N` | Отбор позиций «Угадай ход мастера» из архивных партий в базе (два прохода Stockfish, правила `src/services/guess_selection.py`); пишет `guess_positions`, уже разобранные партии пропускает | Один раз после заполнения архива (`game_id` у каждой базы свои), потом — пополнять; ~600 партий ≈ 3 000 позиций за ~40 мин на 8 процессах. В продакшене: `docker compose exec api python scripts/build_guess_positions.py --games 600 --workers 4` |
| `scripts/loadtest/*` | Нагрузочный тест WebSocket-партий (раздел 7) | Перед запуском на новом сервере |
| `scripts/backup/pg_backup.sh` | Резервные копии и проверка восстановления (раздел 5) | По расписанию (сервис `backup`) |

