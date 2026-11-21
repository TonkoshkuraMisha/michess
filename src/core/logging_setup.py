# --- FILE: src/core/logging_setup.py ---
"""
Журналы сервера (задача по наблюдаемости 21.11.2026): один формат на API, WebSocket и воркеры Celery, чтобы любую
жалобу «у меня пропала партия» можно было разобрать по цепочке событий и воспроизвести.

Что делает модуль:
- Контекст записи (request_id, user_id, game_id, tournament_id, task…) лежит в contextvar и подмешивается в КАЖДУЮ
  строку журнала автоматически — кто бы её ни писал (bind_log_context). Для HTTP контекст заводит
  request_log_middleware, для WebSocket — matchmaking_endpoint, для задач Celery — сигналы в worker/celery_app.py.
- Формат: json (одна JSON-строка на запись — для сбора в Loki/ELK/файлы) или text (для чтения в консоли). Выбирает
  LOG_FORMAT; auto — json в продакшене, text в разработке. Файл с ротацией (LOG_FILE) всегда пишется в json.
- request_log_middleware — «сквозной номер запроса»: берёт X-Request-ID клиента (если он безопасный) или заводит
  свой, возвращает его в ответе и пишет по строке http_request на запрос (метод, шаблон маршрута, статус, время).
  Клиент (frontend/src/services/http.ts) шлёт свой номер в каждом запросе и вместе с ошибкой страницы отправляет
  последние запросы — по ним в журнале находится вся цепочка.

Что в журнал НЕ попадает: тела запросов и ответов, пароли, токены, заголовки Authorization и Cookie, e-mail — только
числовые id и коды. Параметры из адреса не пишутся: логируется шаблон маршрута (/games/{game_id}), а не сам путь.
"""

import contextvars
import json
import logging
import logging.handlers
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import sentry_sdk
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from src.core.config import settings
from src.core.errors import error_payload

# Номер запроса от клиента принимаем только в безопасном виде: он попадает в журнал и в заголовок ответа.
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
REQUEST_ID_HEADER = "X-Request-ID"
# Запросы дольше этого (секунд) пишутся уровнем WARNING: по ним ищут «зависания» без метрик.
SLOW_REQUEST_S = 2.0
# Служебные пути пишутся уровнем DEBUG: опрос здоровья и метрик иначе забил бы журнал.
QUIET_PATHS = frozenset({"/health", "/metrics"})
# Атрибуты обычной записи logging — всё остальное считается «дополнительными полями» (extra=...).
_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "taskName"}

# Поля контекста, которые дублируются тегами событий Sentry.
_SENTRY_TAGS = frozenset({"request_id", "user_id", "game_id", "task", "ws_id"})

_context: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("log_context", default=None)


def bind_log_context(**fields: Any) -> None:
    """Добавляет поля в контекст текущего запроса, сообщения WebSocket или задачи; None-значения пропускаются."""
    current = _context.get()
    if current is None:
        current = {}
        _context.set(current)
    current.update({key: value for key, value in fields.items() if value is not None})
    # Те же поля — тегами события Sentry: по request_id событие находится и в журнале сервера (set_tag без Sentry — пустышка).
    for key in _SENTRY_TAGS & fields.keys():
        if fields[key] is not None:
            sentry_sdk.set_tag(key, str(fields[key]))


def unbind_log_context(*keys: str) -> None:
    """Убирает поля из контекста (например, game_id после действия: соединение живёт дольше действия)."""
    current = _context.get()
    if current:
        for key in keys:
            current.pop(key, None)


def start_log_context(**fields: Any) -> contextvars.Token:
    """Начинает новый контекст (для запроса или задачи); вернувшийся токен передают в end_log_context."""
    token = _context.set({})
    bind_log_context(**fields)
    return token


def end_log_context(token: contextvars.Token) -> None:
    """Возвращает контекст, бывший до start_log_context."""
    _context.reset(token)


def current_log_context() -> dict[str, Any]:
    """Копия текущего контекста (для тестов и для передачи в чужую задачу)."""
    return dict(_context.get() or {})


def new_request_id() -> str:
    """Свой номер запроса, если клиент его не прислал или прислал небезопасный."""
    return uuid.uuid4().hex[:16]


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    return {key: value for key, value in record.__dict__.items() if key not in _STANDARD_ATTRS and not key.startswith("_")}


class JsonFormatter(logging.Formatter):
    """Одна запись — одна JSON-строка: время UTC, уровень, источник, сообщение, контекст, поля и ошибка со стеком."""

    def __init__(self, component: str) -> None:
        super().__init__()
        self.component = component

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "component": self.component,
            "msg": record.getMessage(),
            **(_context.get() or {}),
            **_extra_fields(record),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    """Читаемая строка для консоли разработчика; контекст — в квадратных скобках после сообщения."""

    def format(self, record: logging.LogRecord) -> str:
        context = {**(_context.get() or {}), **_extra_fields(record)}
        tail = " ".join(f"{key}={value}" for key, value in context.items())
        stamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S.%f")[:-3]
        base = f"{stamp} {record.levelname:<7} {record.name}: {record.getMessage()}"
        text = f"{base} [{tail}]" if tail else base
        if record.exc_info:
            text += "\n" + self.formatException(record.exc_info)
        return text


def resolve_format() -> str:
    """json или text: LOG_FORMAT, а при auto — json в продакшене и text в разработке."""
    configured = settings.LOG_FORMAT.lower()
    if configured in ("json", "text"):
        return configured
    return "json" if settings.is_production else "text"


def setup_logging(component: str) -> None:
    """
    Настраивает корневой журнал процесса: консоль (формат по resolve_format) и, если задан LOG_FILE, файл с ротацией
    в json. component — "api" или "worker": пишется в каждую строку json. Повторный вызов заменяет обработчики
    (--reload и тесты не плодят дубли). Строки доступа uvicorn выключены: их заменяет http_request ниже.
    """
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_regence", False):
            root.removeHandler(handler)
    root.setLevel(settings.LOG_LEVEL.upper())

    console = logging.StreamHandler()
    console.setFormatter(JsonFormatter(component) if resolve_format() == "json" else TextFormatter())
    console._regence = True  # type: ignore[attr-defined]
    root.addHandler(console)

    if settings.LOG_FILE:
        file_handler = logging.handlers.RotatingFileHandler(
            settings.LOG_FILE, maxBytes=settings.LOG_FILE_MAX_MB * 1024 * 1024,
            backupCount=settings.LOG_FILE_BACKUPS, encoding="utf-8",
        )
        file_handler.setFormatter(JsonFormatter(component))
        file_handler._regence = True  # type: ignore[attr-defined]
        root.addHandler(file_handler)

    logging.getLogger("uvicorn.access").disabled = True


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or request.url.path


request_logger = logging.getLogger("regence.http")


async def request_log_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """
    Заводит контекст запроса (request_id), пишет строку http_request и возвращает номер в заголовке X-Request-ID.
    Необработанное исключение пишется с полным стеком (http_unhandled_error); клиент получает 500 с кодом
    internal_error и тем же номером в заголовке. Номер от клиента принимается только по REQUEST_ID_PATTERN.
    """
    supplied = request.headers.get(REQUEST_ID_HEADER, "")
    request_id = supplied if REQUEST_ID_PATTERN.match(supplied) else new_request_id()
    token = start_log_context(request_id=request_id)
    start = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
    except Exception:
        request_logger.exception(
            "http_unhandled_error", extra={"method": request.method, "route": _route_template(request)})
        # Ответ 500 в общем формате ошибок и с номером запроса: игрок может назвать его в жалобе, а клиент — приложить
        # к отчёту (в обычном ответе сервера 500 был бы без тела и без заголовка).
        return JSONResponse(
            status_code=500, content={"detail": error_payload("internal_error")}, headers={REQUEST_ID_HEADER: request_id},
        )
    finally:
        duration = time.perf_counter() - start
        route = _route_template(request)
        if route in QUIET_PATHS:
            level = logging.DEBUG
        else:
            level = logging.WARNING if duration > SLOW_REQUEST_S or status >= 500 else logging.INFO
        request_logger.log(level, "http_request", extra={
            "method": request.method, "route": route, "status": status, "duration_ms": round(duration * 1000, 1),
        })
        end_log_context(token)
