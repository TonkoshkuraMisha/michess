# --- FILE: src/services/engine_info.py ---
"""
Сведения о движке для страницы «О проекте» (таск 23.1, лицензия Stockfish GPL-3.0).

GPL требует дать пользователю исходники именно той версии, которая работает у нас. Имя версии берётся у самого
движка (UCI «id name», например «Stockfish 17.1») — так ссылка совпадает с бинарником в образе, а не с последним
релизом. Релизы Stockfish помечены тегами sf_<версия>; сборки разработки ссылаются на список релизов. Полный текст
лицензии в образе — /usr/share/common-licenses/GPL-3 и /usr/share/doc/stockfish/copyright (пакет Debian).

Вызывает GET /bots/engine (src/api/bots.py), путь к бинарнику — resolve_stockfish_path().
"""

import logging
import re
from functools import lru_cache

from src.services.engine_pool import get_engine_pool

logger = logging.getLogger(__name__)

# Исходники движка, на которые ведёт ссылка «исходный код» на странице «О проекте».
REPOSITORY = "https://github.com/official-stockfish/Stockfish"
LICENSE = "GPL-3.0"
LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html"
# Имя релиза из UCI «id name»: «Stockfish 17.1» -> номер версии для тега sf_<версия>.
_RELEASE = re.compile(r"^Stockfish (\d+(?:\.\d+)*)\b")


def source_url(engine_name: str | None) -> str:
    """Исходники этой версии: тег релиза, а для сборок разработки и неизвестных имён — список релизов."""
    match = _RELEASE.match(engine_name or "")
    return f"{REPOSITORY}/tree/sf_{match.group(1)}" if match else f"{REPOSITORY}/releases"


@lru_cache(maxsize=1)
def engine_name(path: str) -> str | None:
    """Имя движка из UCI (один раз за жизнь процесса). None — движок не запускается."""
    try:
        with get_engine_pool(path).acquire() as engine:
            return str(engine.id.get("name") or "") or None
    except Exception as exc:
        logger.warning("Engine name unavailable (%s): %s", path, exc)
        return None


def describe(path: str | None) -> dict:
    """
    Сведения о движке для страницы «О проекте»: название версии, лицензия и ссылка на исходники именно этой версии.
    """
    name = engine_name(path) if path else None
    return {
        "name": name,
        "license": LICENSE,
        "license_url": LICENSE_URL,
        "source_url": source_url(name),
        "repository": REPOSITORY,
    }
