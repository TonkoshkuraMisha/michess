# --- FILE: src/services/bots/calibration.py ---
"""
Измеренная сила ботов (таск 10.4): результат scripts/calibrate_bots.py в calibration.json рядом.

Ключи: id исторического бота ("morphy") или "archetype:<имя>". Если бот ещё не калиброван,
берётся заявленный рейтинг — и это видно по полю measured=False.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CALIBRATION_PATH = Path(__file__).resolve().parent / "calibration.json"


@dataclass(frozen=True)
class Strength:
    rating: int
    measured: bool
    games: int = 0
    ci95: int | None = None


@lru_cache(maxsize=1)
def load_calibration() -> dict:
    try:
        return json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"meta": None, "players": {}}


def strength_of(key: str, declared: int) -> Strength:
    entry = load_calibration().get("players", {}).get(key)
    if not entry:
        return Strength(rating=declared, measured=False)
    return Strength(
        rating=int(entry["rating"]), measured=True, games=int(entry.get("games", 0)), ci95=entry.get("ci95"),
    )
