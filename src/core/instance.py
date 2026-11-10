# --- FILE: src/core/instance.py ---
"""Идентификатор текущего процесса-воркера (uvicorn / gunicorn worker) для координации через Redis."""

import os
import socket
import uuid

WORKER_ID: str = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
