# --- FILE: scripts/e2e_arena.py ---
"""
Арена для сквозного теста в браузере (frontend/e2e/social-arena.e2e.ts): разовая блиц-арена 3+2, которая уже идёт
(начало — минуту назад, конец — через ARENA_MINUTES минут). Расписание конференций такую арену не трогает: у неё нет
schedule_key. Печатает номер арены — CI кладёт его в переменную E2E_ARENA_ID.

    python scripts/e2e_arena.py

Только для одноразового стенда CI: на рабочем сервере не запускать (появится лишняя арена в списке).
"""

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Длительность арены: с запасом на весь прогон E2E.
ARENA_MINUTES = 60
# Контроль арены (блиц 3+2, как у арен расписания).
BASE_MS, INCREMENT_MS = 180_000, 2_000


async def main() -> None:
    """Создаёт идущую арену и печатает её номер."""
    from src.db.session import AsyncSessionLocal
    from src.models.arena import Arena

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        arena = Arena(base_time_ms=BASE_MS, increment_ms=INCREMENT_MS, starts_at=now - timedelta(minutes=1),
                      ends_at=now + timedelta(minutes=ARENA_MINUTES), format="arena")
        db.add(arena)
        await db.commit()
        print(arena.id)


if __name__ == "__main__":
    asyncio.run(main())
