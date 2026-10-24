# Michess API ♟️

An asynchronous chess backend built on a modern architecture. It supports real-time matchmaking, the FIDE Elo rating
system, game analysis, and cheat telemetry collection.

## 🛠 Tech Stack

* **Framework:** FastAPI (Python 3.11+)
* **Database:** PostgreSQL (via asynchronous `asyncpg` + SQLAlchemy 2.0)
* **Cache & Pub/Sub:** Redis (for WebSocket manager and matchmaking queues)
* **Chess Logic:** `python-chess` (move validation, PGN generation, timers)
* **Migrations:** Alembic
* **Testing:** Pytest + asynchronous in-memory Redis mock

## 🚀 Key Features

* **Asynchronous Matchmaking:** Advanced opponent search engine based on Redis `Sorted Sets` with a customizable rating
  fork (default $\pm 150$ points).
* **Real-Time Gameplay:** Move exchange via WebSockets with minimal latency. Instant reaction to connection drops (Grace
  period) and time-outs.
* **FIDE Rating System:** Precise recalculation of Elo ratings with a dynamic K-factor.
* **Anti-Cheat Foundation:** Collection of deterministic telemetry (move time, browser window focus, pre-moves, network
  ping) for subsequent server-side analysis.
* **Profile REST API:** View game history and export raw PGN files.

## 📦 Local Setup (Development)

1. **Clone and Virtual Environment:**

```bash
git clone <your-repo-url>
cd michess
python -m venv michess_env
source michess_env/bin/activate  # For Windows: michess_env\Scripts\activate
pip install -r requirements.txt

```