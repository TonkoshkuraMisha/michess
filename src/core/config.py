# --- FILE: src/core/config.py ---
"""
Настройки приложения: один объект settings на процесс.

Значения читаются из переменных окружения и файла .env в корне проекта (pydantic-settings; образец с пояснениями —
.env.example, продакшен — DEPLOY.md). У каждой настройки ниже — значение по умолчанию и комментарий, что она
меняет: адреса PostgreSQL и Redis, срок токенов, размер пула движков, лимиты запросов по эндпоинтам, почта,
программа беты, арены и конференции. Пороги античита заданы не здесь, а константами в src/services/anticheat.py
(отсюда он читает только AC_PREMOVE_MAX_ELAPSED_MS).

Проверка при старте: в продакшене (ENVIRONMENT=production) слабый или взятый из примера SECRET_KEY останавливает
запуск — этим ключом подписаны токены всех игроков.
"""

import json
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MIN_SECRET_KEY_LENGTH = 32
_WEAK_SECRET_KEYS = {"secret", "changeme", "change_me", "your-secret-key", "test", "dev"}


class Settings(BaseSettings):
    """
    Все настройки приложения. Поле без значения по умолчанию (POSTGRES_*, SECRET_KEY) обязательно: без него в
    окружении или .env процесс не стартует. Имена переменных окружения совпадают с именами полей (с учётом регистра).
    """
    PROJECT_NAME: str = "Regence API"
    # Версия приложения: её отдают /health и /beta/config, она же — метка релиза в Sentry.
    VERSION: str = "1.2.2"
    API_V1_STR: str = "/api/v1"

    # Конференции, по расписанию которых создаются арены (таск 33.4), через запятую. Пока игроков мало, список можно
    # сократить (например, "central"), чтобы не дробить их по аренам пяти поясов.
    ARENA_CONFERENCES: str = "central,western,northern,southern,eastern"
    # Заголовок, в котором прокси перед сервером называет страну посетителя (таск 33.6), например "CF-IPCountry"
    # у Cloudflare. Страна из него только предлагается игроку при выборе; пусто — подсказки по адресу нет.
    COUNTRY_HEADER: str = ""

    # "production" включает строгие проверки при старте (SECRET_KEY) и прячет /docs.
    ENVIRONMENT: str = "development"

    # CORS: в .env — через запятую или JSON-списком. В продакшене за nginx фронтенд и API
    # на одном домене, и CORS не нужен вовсе.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]

    # PostgreSQL: из этих пяти значений собирается адрес базы (async_database_url ниже).
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_SERVER: str
    POSTGRES_PORT: int
    POSTGRES_DB: str

    # Пул соединений с базой — на каждый процесс API (src/db/session.py): постоянных соединений, сколько можно
    # открыть сверх них при нагрузке и сколько секунд запрос ждёт свободное соединение, прежде чем получить ошибку.
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_S: float = 30.0

    # Redis. Короткие таймауты: rate_limit.py и прочие вызовы рассчитаны на fail-open при
    # недоступном Redis, но без них зависшее соединение (например, контейнер в restart-loop)
    # блокирует запрос на десятки секунд вместо быстрого TCP-отказа.
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_CONNECT_TIMEOUT_S: float = 1.0
    REDIS_SOCKET_TIMEOUT_S: float = 1.0
    # Повторы команды без паузы; худшее ожидание при сбое — (1 + REDIS_RETRIES) таймаута.
    REDIS_RETRIES: int = 1

    # Токены входа (JWT, src/core/security.py): ключ подписи и алгоритм.
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    # Access-токен — короткий, клиент держит его в памяти; долгий вход — refresh-токен в httpOnly-cookie (17.5).
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # Флаг Secure у cookie входа; по умолчанию — только в продакшене (ENVIRONMENT=production).
    COOKIE_SECURE: bool | None = None

    # Античит. Шесть настроек ниже остались от первой версии античита и сейчас нигде в коде не читаются: пороги
    # ритма и доверия — константы в src/services/anticheat.py, а путь к Stockfish ищет
    # src/services/bots/base.resolve_stockfish_path (папка bin/, PATH, стандартные пути Linux). Менять их бесполезно.
    AC_BLUR_RATE_HIGH: float = 0.8
    AC_BLUR_RATE_MED: float = 0.5
    AC_MIN_MOVE_TIME_MS: int = 3000
    AC_MAX_MOVE_TIME_MS: int = 8000
    AC_STOCKFISH_PATH: str = "bin/stockfish-windows-x86-64-avx2.exe"
    AC_MAX_CENTIPAWN_LOSS: int = 15
    # Единственная действующая настройка античита: предходу, о котором сообщил клиент, сервер верит, только если сам
    # увидел ход не позже чем через столько миллисекунд (anticheat.trusted_premove). Иначе нечестный игрок пометил бы
    # предходом все ходы и вывел их из оценки ритма.
    AC_PREMOVE_MAX_ELAPSED_MS: int = 600

    # Лобби (src/services/matchmaker.py): окно рейтинга ±N для вызова, когда клиент не прислал своих границ;
    # 0 — без ограничения.
    MATCHMAKING_DEFAULT_RATING_RANGE: int = 0

    # Постановка задач Celery из процесса API (src/services/task_dispatch.py, src/worker/celery_app.py): короткие
    # таймауты, без повторов публикации и пауза после сбоя брокера — недоступный брокер не должен задерживать игру
    # и копить потоки. CELERY_PUBLISH_TIMEOUT_S — сколько ждём саму публикацию.
    CELERY_PUBLISH_TIMEOUT_S: float = 3.0
    # Эндшпильные таблицы (таск 14.4): в разработке — открытый API lichess; в продакшене — свой сервер таблиц с тем же
    # API (решение владельца: таблицы храним у себя, DEPLOY).
    TABLEBASE_URL: str = "https://tablebase.lichess.ovh/standard"
    # Продолжение настроек Celery: таймаут соединения с брокером и пауза, в течение которой после сбоя брокера
    # новые задачи даже не пытаемся ставить.
    CELERY_BROKER_CONNECT_TIMEOUT_S: float = 1.0
    CELERY_BROKER_COOLDOWN_S: float = 30.0

    # Наблюдаемость (src/core/observability.py): Sentry выключен, пока SENTRY_DSN пуст.
    # Доля запросов с трассировкой производительности: 0 — только ошибки.
    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0
    # Журналы (src/core/logging_setup.py): формат json / text / auto (json в продакшене), уровень, необязательный файл
    # с ротацией (пусто — только консоль), его размер в МБ и число копий.
    LOG_FORMAT: str = "auto"
    LOG_LEVEL: str = "INFO"
    LOG_FILE: str = ""
    LOG_FILE_MAX_MB: int = 20
    LOG_FILE_BACKUPS: int = 10
    # Отчёты клиента об ошибках (src/api/client_errors.py): сколько принимать с одного адреса за окно; сверх — отбрасывать.
    RATE_LIMIT_CLIENT_ERRORS: int = 30
    RATE_LIMIT_CLIENT_ERRORS_WINDOW_S: int = 300
    # Метрики воркера Celery (src/core/observability.start_worker_metrics_server): порт, на котором главный процесс
    # воркера отдаёт /metrics своих процессов (время движка в фоновом разборе и симуляциях); 0 — не отдавать.
    # В продакшене задаёт docker-compose.prod.yml (9101), в разработке выключено.
    WORKER_METRICS_PORT: int = 0

    # Пул процессов Stockfish (src/services/engine_pool.py): не больше стольких движков в каждом процессе API и
    # воркера; запрос сверх предела ждёт свободный движок столько секунд и затем получает отказ engine_busy.
    ENGINE_POOL_SIZE: int = 2
    ENGINE_ACQUIRE_TIMEOUT_S: float = 10.0

    # Лимиты запросов (src/api/rate_limit.py): столько запросов за окно RATE_LIMIT_WINDOW_S секунд — на игрока, а без
    # входа — на адрес. Имя настройки передаётся в rate_limit(...) строкой, поэтому поиск по «settings.ИМЯ» эти
    # настройки не находит. RATE_LIMIT_BOT_MOVE — ходы ботов (/bots/move, /bots/custom-move, /bots/draw-offer,
    # /chess960/*); RATE_LIMIT_POSITION_ANALYSIS — оценка позиции, эндшпильные таблицы, «найти мат», справочник
    # дебютов; RATE_LIMIT_GAME_ANALYSIS — полный разбор партии.
    RATE_LIMIT_WINDOW_S: int = 60
    RATE_LIMIT_BOT_MOVE: int = 90
    RATE_LIMIT_POSITION_ANALYSIS: int = 30
    # Без входа анализ позиции доступен, но реже: гостя нельзя связать с идущей партией
    RATE_LIMIT_POSITION_ANALYSIS_GUEST: int = 10
    RATE_LIMIT_GAME_ANALYSIS: int = 6
    # Совет наставника по позиции (POST /analysis/advice) — свой лимит: это тоже работа движка. Тем же лимитом (но
    # отдельными счётчиками) ограничены подсказка по ступеням (/analysis/hint) и «не согласен» (/analysis/dispute).
    RATE_LIMIT_ADVICE: int = 20
    RATE_LIMIT_ADVICE_GUEST: int = 6
    # Проверка хода в игре с наставником (POST /analysis/check-move): каждый ход игрока — один запрос
    RATE_LIMIT_MOVE_CHECK: int = 60
    RATE_LIMIT_MOVE_CHECK_GUEST: int = 20
    # Задачи (/puzzles/*): ход, подсказка, выдача — с запасом на режим на время. Этим же числом (у каждого раздела
    # свой счётчик) ограничены разделы без движка: экзамен, лента, сообщения, библиотека, репертуар, «Просмотр»,
    # тренажёры, мини-игры, команды, совместный разбор, модерация, «Угадай ход», игроки и уведомления.
    RATE_LIMIT_PUZZLES: int = 240
    # Дневные квоты бесплатного тарифа на дорогую работу движка (таск 23.3). Выключены, пока тарифы (25.1) не
    # включат FREE_TIER_LIMITS; базовая игра (ходы ботов, задачи) квот не имеет.
    FREE_TIER_LIMITS: bool = False
    FREE_GAME_ANALYSES_PER_DAY: int = 3
    FREE_COACH_REQUESTS_PER_DAY: int = 300

    # Открытое API только для чтения (таск 24.3, /api/v1/public) и журналы калибровки: запросов за окно.
    RATE_LIMIT_PUBLIC_API: int = 60

    # Импорт партий с lichess и chess.com (таск 24.1): адреса открытых API, лимиты на игрока. MAX_GAMES — партий за
    # один импорт, MAX_STORED — сколько импортированных партий хранится у игрока, RATE_LIMIT_GAME_IMPORT — импортов
    # за окно RATE_LIMIT_GAME_IMPORT_WINDOW_S.
    GAME_IMPORT_LICHESS_URL: str = "https://lichess.org"
    GAME_IMPORT_CHESSCOM_URL: str = "https://api.chess.com"
    GAME_IMPORT_MAX_GAMES: int = 20
    GAME_IMPORT_MAX_STORED: int = 300
    RATE_LIMIT_GAME_IMPORT: int = 10
    RATE_LIMIT_GAME_IMPORT_WINDOW_S: int = 3600

    # Вход и регистрация (src/api/auth.py): все попытки входа с одного адреса, неудачные входы на один аккаунт
    # (этот же счётчик — подтверждение паролем при смене пароля, e-mail и удалении аккаунта), регистрации с адреса.
    RATE_LIMIT_LOGIN_PER_IP: int = 20
    RATE_LIMIT_LOGIN_WINDOW_S: int = 60
    RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT: int = 10
    RATE_LIMIT_LOGIN_FAILURES_WINDOW_S: int = 900
    RATE_LIMIT_REGISTER_PER_IP: int = 5
    RATE_LIMIT_REGISTER_WINDOW_S: int = 3600
    # Программа беты (таск 24.4). REGISTRATION_INVITE_ONLY — регистрация только по коду-приглашению (коды выдаёт
    # модератор); по умолчанию регистрация открыта. COMMUNITY_URL — ссылка на канал сообщества: пусто — не показывается.
    REGISTRATION_INVITE_ONLY: bool = False
    # Согласие с «Правилами сообщества» и «Конфиденциальностью» при регистрации (таск 23.1, src/services/legal.py):
    # без отметки регистрация отклоняется кодом terms_not_accepted.
    REQUIRE_TERMS_CONSENT: bool = True
    COMMUNITY_URL: str = ""
    # «Сообщить о проблеме»: сообщений за окно с адреса (или на игрока); проверок кода-приглашения — с адреса.
    RATE_LIMIT_FEEDBACK: int = 5
    RATE_LIMIT_FEEDBACK_WINDOW_S: int = 3600
    RATE_LIMIT_INVITE_CHECK: int = 20
    # Письма со ссылками (подтверждение e-mail, сброс пароля): не больше N запросов на адрес и на IP за окно.
    RATE_LIMIT_EMAIL_PER_ADDRESS: int = 3
    RATE_LIMIT_EMAIL_PER_IP: int = 10
    RATE_LIMIT_EMAIL_WINDOW_S: int = 3600

    # Почта (таск 17.5). SMTP_HOST пуст — письма не отправляются, а пишутся в лог (разработка). Любой провайдер
    # (Brevo, Amazon SES, Postmark…) или свой сервер — только эти переменные, код не меняется.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = True
    MAIL_FROM: str = "regence <noreply@localhost>"
    # Адрес сайта для ссылок в письмах.
    PUBLIC_BASE_URL: str = "http://localhost:5173"
    EMAIL_VERIFY_TTL_S: int = 24 * 3600
    PASSWORD_RESET_TTL_S: int = 3600

    # Одноразовые тикеты WebSocket (токен входа в адрес WebSocket не попадает — src/api/deps.py): срок жизни тикета
    # в секундах и сколько тикетов игрок может получить за минуту (окно 60 с задано в src/api/auth.py).
    WS_TICKET_TTL_S: int = 30
    RATE_LIMIT_WS_TICKETS: int = 30

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value):
        """CORS_ORIGINS из окружения: строка через запятую или JSON-список; готовый список — как есть."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _check_production_secrets(self):
        """
        В продакшене слабый SECRET_KEY = возможность подделать токен любого пользователя.
        Лучше не стартовать вовсе, чем работать с ключом из примера или коротким ключом.
        """
        if self.is_production:
            key = self.SECRET_KEY
            if len(key) < MIN_SECRET_KEY_LENGTH or key.lower() in _WEAK_SECRET_KEYS or "change-me" in key.lower():
                raise ValueError(
                    f"SECRET_KEY must be a random string of at least {MIN_SECRET_KEY_LENGTH} characters "
                    "in production (e.g. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`)"
                )
        return self

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def async_database_url(self) -> str:
        """Адрес PostgreSQL для драйвера asyncpg, собранный из настроек POSTGRES_*."""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
