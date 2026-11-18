"""
Наблюдаемость: сбор ошибок в Sentry и метрики Prometheus.

Sentry включается только при заданном SENTRY_DSN (без него — полностью выключен). Персональные
данные (cookie, заголовки авторизации, IP) не отправляются. Интеграции FastAPI, Celery, SQLAlchemy
и logging подключаются автоматически: всё, что логируется через logger.exception/error (сбои
WS-действий, цикла таймаутов, анализа партий), становится событием Sentry.

Метрики отдаются на GET /metrics самого API — nginx этот путь наружу не проксирует, его читает
Prometheus изнутри сети compose (api:8000/metrics). API работает в нескольких процессах uvicorn
(WEB_CONCURRENCY), поэтому в продакшене включён multiprocess-режим prometheus_client: каждый
процесс пишет значения в файлы PROMETHEUS_MULTIPROC_DIR, а /metrics суммирует их по всем
процессам. Переменная должна быть задана до импорта prometheus_client: её задаёт сервис api в
docker-compose.prod.yml (каталог /tmp/prometheus на tmpfs, очищается при старте контейнера). В разработке
переменной нет — метрики берутся из памяти единственного процесса.

Воркеры Celery (фоновый разбор, симуляции турниров) отдают свои метрики сами — start_worker_metrics_server на порту
WORKER_METRICS_PORT; так michess_engine_seconds_total учитывает и фоновую работу движка.

Откуда значения: счётчики WebSocket увеличивает src/api/websockets.py, HTTP — http_metrics_middleware ниже,
законченные партии и сбои цикла часов — src/services/game_state.py, время движка — src/services/engine_pool.py,
число игроков за сутки — Redis (ключ active_players:<дата UTC>, отметку ставит src/api/deps.get_current_user).
"""

import logging
import os
import re
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)
from starlette.requests import Request
from starlette.responses import Response

from src.core.config import settings

logger = logging.getLogger(__name__)

# --- Метрики ------------------------------------------------------------------------------------
# Метки — только из конечных наборов (имя действия из реестра, шаблон маршрута, исход), никогда
# не id пользователей или партий: иначе число временных рядов растёт без предела.

WS_CONNECTIONS = Gauge(
    "michess_ws_connections", "Open WebSocket connections", multiprocess_mode="livesum",
)
WS_ACTIONS = Counter(
    "michess_ws_actions_total", "Processed WebSocket actions", ["action", "outcome"],
)
WS_ACTION_SECONDS = Histogram(
    "michess_ws_action_seconds", "WebSocket action processing time (make_move = move latency)", ["action"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)
HTTP_REQUESTS = Counter(
    "michess_http_requests_total", "HTTP requests", ["method", "route", "status"],
)
HTTP_REQUEST_SECONDS = Histogram(
    "michess_http_request_seconds", "HTTP request processing time", ["method", "route"],
)
DB_POOL_CHECKED_OUT = Gauge(
    "michess_db_pool_checked_out", "Database connections currently checked out of the pool",
    multiprocess_mode="livesum",
)
# Только партии между людьми (game_state.finish_game); партии с ботами (/bots/save-game) сюда не входят.
GAMES_FINISHED = Counter(
    "michess_games_finished_total", "Games finished and recorded in the database", ["termination"],
)
TIMEOUT_CHECK_FAILURES = Counter(
    "michess_timeout_check_failures_total", "Failed timeout checks of individual games",
)
# Бюджет движка (таск 23.3): «процессор на активного игрока в день» =
#   increase(michess_engine_seconds_total[1d]) / michess_active_players_today (в конце суток UTC).
# Время движка считает сам пул (src/services/engine_pool.py), игроков за день — HyperLogLog в Redis.
ACTIVE_PLAYERS_TODAY = Gauge(
    "michess_active_players_today", "Distinct logged-in players seen today (UTC)", multiprocess_mode="mostrecent",
)
# Суточный счётчик игроков хранится в Redis трое суток — с запасом, чтобы вчерашнее значение ещё можно было прочесть.
ACTIVE_PLAYERS_TTL_S = 3 * 86400

# Исходы WS-действия.
OUTCOME_OK = "ok"
OUTCOME_IGNORED = "ignored"
OUTCOME_REJECTED = "rejected"  # MatchmakingError: штатный отказ с объяснением клиенту
OUTCOME_ERROR = "error"
OUTCOME_RATE_LIMITED = "rate_limited"


_LABEL_RE = re.compile(r"^[a-z_]{1,40}$")


def bounded_label(value: object) -> str:
    """Значение метки из конечного набора: всё, что не похоже на короткий идентификатор, — "other"."""
    text = str(value or "").lower()
    return text if _LABEL_RE.match(text) else "other"


def _active_players_key(now: datetime | None = None) -> str:
    return f"active_players:{(now or datetime.now(UTC)).strftime('%Y-%m-%d')}"


async def note_active_player(user_id: int) -> None:
    """Отмечает игрока активным сегодня (HyperLogLog: ~12 КБ на сутки при любом числе игроков)."""
    from src.db import redis as redis_module

    key = _active_players_key()
    try:
        if await redis_module.redis_client.pfadd(key, user_id):
            await redis_module.redis_client.expire(key, ACTIVE_PLAYERS_TTL_S)
    except Exception as exc:  # метрика не должна ронять запрос
        logger.debug("Active player mark failed: %s", exc)


async def refresh_active_players() -> None:
    """Перед отдачей /metrics: число игроков за сегодня из Redis."""
    from src.db import redis as redis_module

    try:
        ACTIVE_PLAYERS_TODAY.set(await redis_module.redis_client.pfcount(_active_players_key()))
    except Exception as exc:
        logger.debug("Active players count failed: %s", exc)


def metrics_response() -> Response:
    """
    Тело ответа /metrics в формате Prometheus. Если задан PROMETHEUS_MULTIPROC_DIR, значения суммируются из файлов
    всех процессов uvicorn; иначе берётся реестр текущего процесса.
    """
    return Response(generate_latest(_collect_registry()), media_type=CONTENT_TYPE_LATEST)


def _collect_registry() -> CollectorRegistry:
    """Реестр для отдачи метрик: сумма файлов всех процессов (multiprocess) или реестр текущего процесса."""
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        return registry
    return REGISTRY


def start_worker_metrics_server(port: int) -> bool:
    """
    Отдаёт /metrics воркера Celery на port (поток в главном процессе воркера; вызывает сигнал worker_init в
    src/worker/celery_app.py). Задачи выполняют дочерние процессы, поэтому у сервисов worker и worker-simulation,
    как у api, задан PROMETHEUS_MULTIPROC_DIR — свой tmpfs у каждого контейнера: общий каталог с api нельзя, номера
    процессов в разных контейнерах совпадают, и файлы метрик затирали бы друг друга. Prometheus опрашивает
    worker:9101 и worker-simulation:9101 вместе с api:8000 (DEPLOY.md, раздел 6) и суммирует сам. port 0 — выключено.
    """
    if port <= 0:
        return False
    from prometheus_client import start_http_server

    start_http_server(port, registry=_collect_registry())
    logger.info("Worker metrics on port %s", port)
    return True


def forget_worker_process(pid: int) -> None:
    """
    Дочерний процесс воркера завершился: его файлы «живых» показателей (Gauge livesum/liveall) удаляются, чтобы
    сумма не учитывала умерший процесс. Счётчики (время движка) остаются — их сумма не должна уменьшаться.
    """
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        multiprocess.mark_process_dead(pid)


def route_template(scope) -> str:
    """
    Шаблон маршрута (/api/v1/profile/{username}), а не фактический путь — конечный набор меток.

    Начиная с FastAPI 0.14x маршрут подключённого роутера хранит путь без префикса include_router
    (/profile/{username}), поэтому префикс берётся из фактического пути: столько последних
    сегментов, сколько их в шаблоне, — это и есть подставленный шаблон.
    """
    route = scope.get("route")
    template = getattr(route, "path_format", None) or getattr(route, "path", None)
    if not template:
        return "unmatched"
    if ":path}" in template:  # параметр может содержать "/", сегменты не сопоставить
        return template
    path_segments = scope.get("path", "").strip("/").split("/")
    template_segments = template.strip("/").split("/")
    prefix_len = len(path_segments) - len(template_segments)
    if prefix_len <= 0:
        return template
    return "/" + "/".join(path_segments[:prefix_len]) + template


async def http_metrics_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """
    Считает HTTP-запросы и их длительность по шаблону маршрута и коду ответа; сам запрос метрик (/metrics) не
    учитывается.
    """
    start = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route_label = route_template(request.scope)
        if route_label != "/metrics":
            HTTP_REQUESTS.labels(request.method, route_label, str(status)).inc()
            HTTP_REQUEST_SECONDS.labels(request.method, route_label).observe(time.perf_counter() - start)


def instrument_engine(engine) -> None:
    """Счётчик занятых соединений пула по событиям checkout/checkin движка SQLAlchemy."""
    from sqlalchemy import event

    sync_engine = getattr(engine, "sync_engine", engine)
    event.listen(sync_engine, "checkout", lambda *_: DB_POOL_CHECKED_OUT.inc())
    event.listen(sync_engine, "checkin", lambda *_: DB_POOL_CHECKED_OUT.dec())


# --- Sentry -------------------------------------------------------------------------------------

def init_sentry(component: str) -> bool:
    """
    Подключает Sentry, если задан SENTRY_DSN; возвращает, подключён ли. component — "api" (вызов в src/main.py) или
    "worker" (src/worker/celery_app.py), попадает в тег событий. Релиз — michess@VERSION, личные данные не
    отправляются (send_default_pii=False).
    """
    if not settings.SENTRY_DSN:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=f"michess@{settings.VERSION}",
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
    )
    sentry_sdk.set_tag("component", component)
    logger.info("Sentry enabled for %s (%s)", component, settings.ENVIRONMENT)
    return True
