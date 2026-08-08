import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.core.config import settings
from src.api.auth import router as auth_router
from src.api.websockets import router as ws_router
from src.api.profile import router as profile_router  # <-- Импорт роутера профиля
from src.db.redis import redis_client
from src.services.game_state import state_manager
from src.services.connection_manager import manager
from src.api.analysis import router as analysis_router

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for handling startup and shutdown events gracefully.
    This is the recommended place to initialize DB connection pools, Redis instances, and background tasks.
    """
    logger.info("Starting up %s...", settings.PROJECT_NAME)

    # Запускаем фоновый мониторинг таймаутов партий
    timeout_task = asyncio.create_task(state_manager.check_timeouts_loop(manager))

    yield

    # Корректно завершаем фоновые таски и пул соединений Redis
    timeout_task.cancel()
    try:
        await asyncio.gather(timeout_task, return_exceptions=True)
    except asyncio.CancelledError:
        pass

    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    await redis_client.aclose()


def create_app() -> FastAPI:
    """
    Application factory pattern.
    Provides better isolation for testing and modularity.
    """
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url=f"{settings.API_V1_STR}/openapi.json"
    )

    # Configure CORS middleware for frontend integration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Must be restricted to specific domains in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routers
    app.include_router(auth_router, prefix=settings.API_V1_STR)
    app.include_router(ws_router, prefix=settings.API_V1_STR)
    app.include_router(profile_router, prefix=settings.API_V1_STR)
    app.include_router(analysis_router, prefix=settings.API_V1_STR)

    return app


# Initialize the application
app = create_app()


@app.get("/health")
async def health_check() -> dict:
    """
    Liveness probe endpoint.
    Used by load balancers and orchestrators (e.g., Docker, Kubernetes) to verify server health.
    """
    return {"status": "healthy", "version": settings.VERSION}


@app.websocket("/ws/ping")
async def websocket_test_endpoint(websocket: WebSocket):
    """
    Test WebSocket endpoint for validating client connections.
    """
    await websocket.accept()
    logger.info("WebSocket client connected.")
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
    # Run the server via Uvicorn for local development
    uvicorn.run("src.main:app", host="127.0.0.1", port=8000, reload=True)