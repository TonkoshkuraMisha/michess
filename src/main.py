# --- FILE: src/main.py ---

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from src.api import bots, ladder, learn, personalities, puzzles, themes, tournaments
from src.api.analysis import router as analysis_router
from src.api.auth import router as auth_router
from src.api.profile import router as profile_router
from src.api.websockets import router as ws_router
from src.core.config import settings
from src.core.errors import validation_error_items
from src.core.observability import http_metrics_middleware, init_sentry, metrics_response
from src.db import redis as redis_module
from src.db.session import AsyncSessionLocal
from src.services.connection_manager import manager
from src.services.engine_pool import close_all_engine_pools
from src.services.game_state import state_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

init_sentry("api")

HEALTH_CHECK_TIMEOUT_S = 2.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for handling startup and shutdown events gracefully."""
    logger.info("Starting up %s (%s)...", settings.PROJECT_NAME, settings.ENVIRONMENT)
    timeout_task = asyncio.create_task(state_manager.check_timeouts_loop(manager))

    yield

    timeout_task.cancel()
    try:
        await asyncio.gather(timeout_task, return_exceptions=True)
    except asyncio.CancelledError:
        pass

    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    await asyncio.to_thread(close_all_engine_pools)
    await redis_module.redis_client.aclose()


def create_app() -> FastAPI:
    # Документация API в продакшене не публикуется: она раскрывает все эндпоинты и схемы.
    docs_enabled = not settings.is_production
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url=f"{settings.API_V1_STR}/openapi.json" if docs_enabled else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.middleware("http")(http_metrics_middleware)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Без эха присланных значений (в ответе оказывался бы, например, пароль) и с параметрами
        # проверки, из которых клиент соберёт текст на языке игрока.
        return JSONResponse(status_code=422, content={"detail": validation_error_items(exc.errors())})

    app.include_router(auth_router, prefix=settings.API_V1_STR)
    app.include_router(ws_router, prefix=settings.API_V1_STR)
    app.include_router(profile_router, prefix=settings.API_V1_STR)
    app.include_router(analysis_router, prefix=settings.API_V1_STR)
    app.include_router(bots.router, prefix="/api/v1/bots", tags=["bots"])
    app.include_router(personalities.router, prefix="/api/v1/bots/personalities", tags=["bots"])
    app.include_router(ladder.router, prefix="/api/v1/bots/ladder", tags=["bots"])
    app.include_router(themes.router, prefix="/api/v1/themes", tags=["training"])
    app.include_router(puzzles.router, prefix="/api/v1/puzzles", tags=["training"])
    app.include_router(learn.router, prefix="/api/v1/learn", tags=["training"])
    app.include_router(tournaments.router, prefix="/api/v1/tournaments", tags=["tournaments"])

    return app


app = create_app()


async def _check_database() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT 1"))


async def _check_redis() -> None:
    await redis_module.redis_client.ping()


@app.get("/health")
async def health_check():
    """
    Готовность сервиса: отвечают ли PostgreSQL и Redis. 503, если хоть что-то недоступно, —
    по этому коду Docker и балансировщик понимают, что экземпляр нельзя нагружать.
    """
    checks: dict[str, str] = {}
    for name, check in (("database", _check_database), ("redis", _check_redis)):
        try:
            await asyncio.wait_for(check(), timeout=HEALTH_CHECK_TIMEOUT_S)
            checks[name] = "ok"
        except Exception as exc:
            logger.warning("Health check '%s' failed: %s", name, exc)
            checks[name] = "unavailable"

    healthy = all(status == "ok" for status in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "healthy" if healthy else "degraded", "version": settings.VERSION, "checks": checks},
    )

@app.get("/metrics", include_in_schema=False)
async def metrics():
    """Метрики Prometheus. Наружу через nginx не публикуется — только внутри сети compose."""
    return metrics_response()


if __name__ == "__main__":
    uvicorn.run("src.main:app", host="127.0.0.1", port=8000, reload=True)
