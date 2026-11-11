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
процессам. Переменная должна быть задана до импорта prometheus_client (это делает Dockerfile).
"""

import logging
import os
import re
import time
from collections.abc import Awaitable, Callable

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
GAMES_FINISHED = Counter(
    "michess_games_finished_total", "Games finished and recorded in the database", ["termination"],
)
TIMEOUT_CHECK_FAILURES = Counter(
    "michess_timeout_check_failures_total", "Failed timeout checks of individual games",
)

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


def metrics_response() -> Response:
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    else:
        registry = REGISTRY
    return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)


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
    """Подключает Sentry, если задан SENTRY_DSN. component — "api" или "worker" (тег событий)."""
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
