# --- FILE: src/services/bots/__init__.py ---
"""
Исторические боты первой волны: реестр BOT_INSTANCES (id → готовый бот).

Каждый бот — свой модуль рядом (philidor.py … zukertort.py) с дебютной книгой и правилами стиля; общий порядок
выбора хода — base.HistoricalBot. Мастера второй волны и остальные соперники собираются из настроек характера
(masters.py, guests.py, archetypes.py, personality.py).
"""

from src.services.bots.anderssen import AnderssenBot, anderssen_bot
from src.services.bots.base import HistoricalBot, normalize_fen_key, resolve_stockfish_path
from src.services.bots.labourdonnais import LabourdonnaisBot, labourdonnais_bot
from src.services.bots.masters import MASTER_BOTS
from src.services.bots.morphy import MorphyBot, morphy_bot
from src.services.bots.paulsen import PaulsenBot, paulsen_bot
from src.services.bots.philidor import PhilidorBot, philidor_bot
from src.services.bots.staunton import StauntonBot, staunton_bot
from src.services.bots.zukertort import ZukertortBot, zukertort_bot

BOT_INSTANCES: dict[str, HistoricalBot] = {
    "philidor": philidor_bot,
    "labourdonnais": labourdonnais_bot,
    "staunton": staunton_bot,
    "anderssen": anderssen_bot,
    "morphy": morphy_bot,
    "paulsen": paulsen_bot,
    "zukertort": zukertort_bot,
    **MASTER_BOTS,  # мастера второй волны (таск 21.5)
}

__all__ = [
    "HistoricalBot",
    "PhilidorBot",
    "LabourdonnaisBot",
    "StauntonBot",
    "AnderssenBot",
    "MorphyBot",
    "PaulsenBot",
    "ZukertortBot",
    "philidor_bot",
    "labourdonnais_bot",
    "staunton_bot",
    "anderssen_bot",
    "morphy_bot",
    "paulsen_bot",
    "zukertort_bot",
    "BOT_INSTANCES",
    "normalize_fen_key",
    "resolve_stockfish_path",
]
