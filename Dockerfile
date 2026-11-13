# --- FILE: Dockerfile ---
# Образ бэкенда: один и тот же для API (uvicorn), Celery-воркера и миграций —
# различается только команда запуска (см. docker-compose.prod.yml).

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Stockfish из пакетов Debian (/usr/games/stockfish — его находит resolve_stockfish_path).
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY scripts ./scripts
# Выборка задач (CC0) — загружается в базу сервисом migrate.
COPY data/puzzles ./data/puzzles
# Таблица seed упражнений-генераторов (таск 13.7) — позиции восстанавливаются по ней.
COPY data/drills ./data/drills
COPY src ./src

# Не root: при уязвимости в приложении у процесса нет прав на систему контейнера.
RUN useradd --create-home --uid 10001 michess \
    && mkdir -p /app/src/db/data/pgns \
    && chown -R michess:michess /app/src/db/data
USER michess

EXPOSE 8000

# --proxy-headers + FORWARDED_ALLOW_IPS: реальный IP клиента из X-Forwarded-For от nginx
#   (иначе лимиты по IP считались бы общими на всех пользователей).
# --ws-max-size: кадр WebSocket больше 16 КБ отбрасывается ещё до приложения.
# Число процессов — переменная WEB_CONCURRENCY (uvicorn читает её сам).
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--ws-max-size", "16384"]
