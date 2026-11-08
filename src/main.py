# --- FILE: src/main.py ---

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.core.config import settings
from src.api.auth import router as auth_router
from src.api.websockets import router as ws_router
from src.api import bots
from src.api.profile import router as profile_router
from src.api.analysis import router as analysis_router
from src.db.redis import redis_client
from src.services.game_state import state_manager
from src.services.connection_manager import manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for handling startup and shutdown events gracefully."""
    logger.info("Starting up %s...", settings.PROJECT_NAME)
    timeout_task = asyncio.create_task(state_manager.check_timeouts_loop(manager))

    yield

    timeout_task.cancel()
    try:
        await asyncio.gather(timeout_task, return_exceptions=True)
    except asyncio.CancelledError:
        pass

    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    await redis_client.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router, prefix=settings.API_V1_STR)
    app.include_router(ws_router, prefix=settings.API_V1_STR)
    app.include_router(profile_router, prefix=settings.API_V1_STR)
    app.include_router(analysis_router, prefix=settings.API_V1_STR)
    app.include_router(bots.router, prefix="/api/v1/bots", tags=["bots"])

    return app


app = create_app()


@app.get("/health")
async def health_check() -> dict:
    return {"status": "healthy", "version": settings.VERSION}


@app.websocket("/ws/ping")
async def websocket_test_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        await websocket.send_json({"event": "connected", "message": "Connection established"})
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"event": "echo", "received": data})
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected normally.")
    except Exception as e:
        logger.error("WebSocket connection error: %s", e)


if __name__ == "__main__":
    uvicorn.run("src.main:app", host="127.0.0.1", port=8000, reload=True)
