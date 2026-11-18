# --- FILE: src/core/instance.py ---
"""
Идентификатор текущего процесса API (имя хоста, номер процесса и случайный хвост) для координации через Redis.

Им подписывается лидер цикла часов партий (ключ timeouts:leader, src/services/game_state.py) и рассылка событий
между процессами (src/services/connection_manager.py). Создаётся заново при каждом старте процесса.
"""

import os
import socket
import uuid

WORKER_ID: str = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
