import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.core.config import settings
from src.api.auth import router as auth_router
from src.api.websockets import router as ws_router

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
    This is the recommended place to initialize DB connection pools and Redis instances.
    """
    logger.info("Starting up %s...", settings.PROJECT_NAME)
    # TODO: Initialize PostgreSQL engine and Redis connection pool here
    yield
    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    # TODO: Gracefully close DB and Redis connections here


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