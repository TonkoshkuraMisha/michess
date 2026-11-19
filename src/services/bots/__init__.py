# --- FILE: src/services/bots/__init__.py ---
"""
Реестр готовых ботов BOT_INSTANCES (id → экземпляр) и точка входа в пакет ботов.

В реестре — семь исторических ботов первой волны (каждый в своём модуле рядом: philidor.py … zukertort.py, с дебютной
книгой и правилами стиля) и мастера из masters.py (MASTER_BOTS). Общий порядок выбора хода — base.HistoricalBot.
Архетипы мастерской (archetypes.py) и «мастера прошлого» (guests.py) в реестр не входят: их строят на лету из
настроек характера (personality.py).

Реестр читают память ботов (memory.py: книга бота по id) и симуляция турниров (tournament_simulation.py: свежий бот
как type(bot)()). Маршруты src/api/bots.py берут ботов из этого реестра.
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
    **MASTER_BOTS,  # мастера из masters.py (таск 21.5 и последующие волны)
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
