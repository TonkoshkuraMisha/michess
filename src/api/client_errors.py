# --- FILE: src/api/client_errors.py ---
"""
Отчёты об ошибках клиента (наблюдаемость, 21.11.2026): POST /client-errors принимает от страницы сведения о сбое —
ошибка отрисовки, необработанное исключение, оборванное соединение — и пишет их в журнал сервера строкой
`client_error` (логгер regence.client) вместе с номером запроса и игроком. Так баг «страница внезапно обновилась»
виден в одном журнале с серверными событиями: по `request_id` из «хлебных крошек» находится вся цепочка.

Открыт без входа (сбой может случиться до входа), поэтому: размеры всех полей ограничены, лимит на адрес
(RATE_LIMIT_CLIENT_ERRORS за окно) — сверх лимита отчёты молча отбрасываются (ответ тот же 204: клиенту сообщать о
лимите незачем, а повторять отправку он не должен). В базу ничего не пишется. Тела запросов, токены и личные данные
клиент не присылает; сервер в любом случае пишет только присланные короткие поля. Клиентская часть —
frontend/src/services/clientErrors.ts.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field

from src.api.rate_limit import client_ip, try_consume
from src.core.config import settings
from src.core.logging_setup import REQUEST_ID_PATTERN, bind_log_context

router = APIRouter(tags=["observability"])
client_logger = logging.getLogger("regence.client")

# Пределы полей отчёта: лишнее отсекается при разборе, а не молча принимается.
MAX_MESSAGE = 500
MAX_STACK = 4000
MAX_URL = 300
MAX_BREADCRUMBS = 30


class Breadcrumb(BaseModel):
    """Одно событие перед сбоем: запрос к API (с номером), сообщение WebSocket, смена страницы."""
    t: int = Field(..., description="Unix-время в миллисекундах")
    kind: Literal["request", "socket", "route", "reload"]
    name: str = Field(..., max_length=120)
    status: int | None = None
    request_id: str | None = Field(None, max_length=64)


class ClientErrorIn(BaseModel):
    """Отчёт страницы о сбое."""
    kind: Literal["render", "error", "unhandledrejection", "socket", "reload"]
    message: str = Field(..., max_length=MAX_MESSAGE)
    stack: str | None = Field(None, max_length=MAX_STACK)
    url: str = Field(..., max_length=MAX_URL)
    release: str | None = Field(None, max_length=40)
    game_id: int | None = None
    breadcrumbs: list[Breadcrumb] = Field(default_factory=list, max_length=MAX_BREADCRUMBS)


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def report_client_error(report: ClientErrorIn, request: Request) -> Response:
    """Пишет отчёт клиента в журнал; сверх лимита с адреса — тихо отбрасывает (204 в обоих случаях)."""
    if not await try_consume("client_error", f"ip:{client_ip(request)}",
                             settings.RATE_LIMIT_CLIENT_ERRORS, settings.RATE_LIMIT_CLIENT_ERRORS_WINDOW_S):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    bind_log_context(game_id=report.game_id)
    crumbs = [c.model_dump(exclude_none=True) for c in report.breadcrumbs]
    # Номера запросов из крошек — отдельным списком: по ним удобно искать серверные строки.
    related = [c["request_id"] for c in crumbs if REQUEST_ID_PATTERN.match(c.get("request_id", ""))]
    client_logger.error("client_error", extra={
        "client_kind": report.kind, "client_message": report.message, "client_stack": report.stack,
        "client_url": report.url, "release": report.release, "breadcrumbs": crumbs, "related_request_ids": related,
    })
    return Response(status_code=status.HTTP_204_NO_CONTENT)
