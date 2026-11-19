# --- FILE: src/services/bots/calibration.py ---
"""
Измеренная сила ботов (таск 10.4): результат scripts/calibrate_bots.py в calibration.json рядом.

Ключи: id исторического бота ("morphy") или "archetype:<имя>". Если бот ещё не калиброван,
берётся заявленный рейтинг — и это видно по полю measured=False.

Данные: calibration.json (поля meta и players: ключ → rating, games, ci95) и журналы прогонов в
scripts/calibration_runs/. Читают их src/api/bots.py и src/api/public.py (страница «Как мы измеряем силу ботов») и
memory.py (начальный рейтинг бота).
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# Результат последней калибровки (его пишет scripts/calibrate_bots.py).
CALIBRATION_PATH = Path(__file__).resolve().parent / "calibration.json"
# Журналы прогонов калибровки (таск 24.3, страница «Как мы измеряем силу ботов»): что с чем играло и чем кончилось.
RUNS_DIR = Path(__file__).resolve().parents[3] / "scripts" / "calibration_runs"
# Допустимое имя журнала: ГГГГ-ММ-ДД_название.log (протокол) или .pgn (партии); других файлов страница не отдаёт.
RUN_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})_([a-z0-9_]{1,60})\.(log|pgn)$")


@dataclass(frozen=True)
class Strength:
    """Сила бота: рейтинг, измерен ли он матчами (measured), число партий и 95 %-й доверительный интервал (±)."""

    rating: int
    measured: bool
    games: int = 0
    ci95: int | None = None


@lru_cache(maxsize=1)
def load_calibration() -> dict:
    """Содержимое calibration.json, кэш на процесс; нет файла или он испорчен — пустой набор {meta: None, players: {}}."""
    try:
        return json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"meta": None, "players": {}}


def strength_of(key: str, declared: int) -> Strength:
    """Сила бота по ключу: измеренная из калибровки или, если её нет, заявленная declared (measured=False)."""
    entry = load_calibration().get("players", {}).get(key)
    if not entry:
        return Strength(rating=declared, measured=False)
    return Strength(
        rating=int(entry["rating"]), measured=True, games=int(entry.get("games", 0)), ci95=entry.get("ci95"),
    )


def runs() -> list[dict]:
    """Журналы прогонов, от новых к старым: имя файла, дата, вид (log — протокол, pgn — партии) и размер."""
    if not RUNS_DIR.is_dir():
        return []
    found = []
    for path in RUNS_DIR.iterdir():
        match = RUN_NAME.match(path.name)
        if match and path.is_file():
            found.append({"name": path.name, "date": match.group(1), "title": match.group(2), "kind": match.group(3),
                          "size": path.stat().st_size})
    return sorted(found, key=lambda item: (item["date"], item["name"]), reverse=True)


def read_run(name: str) -> str | None:
    """Текст журнала по имени из runs(); имя сверяется с шаблоном — путь наружу папки не уводит."""
    if not RUN_NAME.match(name):
        return None
    path = RUNS_DIR / name
    try:
        return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else None
    except OSError:
        return None
