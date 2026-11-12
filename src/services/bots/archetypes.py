# --- FILE: src/services/bots/archetypes.py ---
"""
Готовые архетипы мастерской соперников (таск 10.3) — источник правды на сервере: их калибрует
scripts/calibrate_bots.py, по ним строится клубная лестница (таск 10.4), фронтенд получает их через
GET /bots/catalog. Персонажи вымышленные — не реальные люди и не герои чужих программ.
"""

from dataclasses import dataclass

from src.services.bots.personality import BotPersonalityConfig, PieceValues


@dataclass(frozen=True)
class Archetype:
    name: str
    bio: str
    config: BotPersonalityConfig

    @property
    def key(self) -> str:
        """Ключ в калибровке и на лестнице."""
        return f"archetype:{self.name}"


def _cfg(piece_values: dict | None = None, **fields) -> BotPersonalityConfig:
    return BotPersonalityConfig(piece_values=PieceValues(**(piece_values or {})), **fields)


ARCHETYPES: tuple[Archetype, ...] = (
    Archetype(
        "Торопыга",
        "Выводит ферзя на третьем ходу и ищет мат в два хода. Иногда находит.",
        _cfg(aggression=70, king_safety=30, mobility=60, randomness=80, blunder_guard_cp=320, target_elo=700),
    ),
    Archetype(
        "Тихоня",
        "Никуда не спешит, размены любит больше атак и ждёт, пока соперник ошибётся сам.",
        _cfg(aggression=-70, king_safety=160, randomness=40, blunder_guard_cp=220, target_elo=900),
    ),
    Archetype(
        "Пешечник",
        "Считает каждую пешку и строит цепи, о которые разбиваются любые наскоки.",
        _cfg({"pawn": 1.4}, pawn_structure=200, center_control=140, target_elo=1100),
    ),
    Archetype(
        "Кавалерист",
        "Обожает коней и не меняет их даже на слонов: «конь на краю — и тот полезен».",
        _cfg({"knight": 4.0, "bishop": 2.6}, mobility=160, aggression=30, target_elo=1250),
    ),
    Archetype(
        "Центровик",
        "Весь дебют — борьба за четыре центральных поля, а потом посмотрим.",
        _cfg(center_control=200, mobility=120, randomness=15, target_elo=1400),
    ),
    Archetype(
        "Крепость",
        "Рокируется при первой возможности и не трогает пешки перед королём.",
        _cfg(aggression=-60, king_safety=200, pawn_structure=140, randomness=10, target_elo=1550),
    ),
    Archetype(
        "Авантюрист",
        "Жертвует фигуру «на интуицию» и верит, что инициатива дороже материала.",
        _cfg(aggression=95, king_safety=60, randomness=60, blunder_guard_cp=260, target_elo=1650),
    ),
    Archetype(
        "Стратег",
        "Медленно улучшает позицию фигур и душит соперника нехваткой пространства.",
        _cfg(aggression=-30, center_control=150, pawn_structure=160, randomness=10, blunder_guard_cp=90,
             target_elo=1800),
    ),
    Archetype(
        "Охотник",
        "Ведёт все фигуры к чужому королю, о своём вспоминает в последний момент.",
        _cfg(aggression=100, king_safety=50, mobility=150, blunder_guard_cp=180, target_elo=2000),
    ),
    Archetype(
        "Комбинатор",
        "Видит удары на несколько ходов вперёд и почти не ошибается в расчёте.",
        _cfg(aggression=80, mobility=160, randomness=10, blunder_guard_cp=150, target_elo=2200),
    ),
)

ARCHETYPES_BY_NAME = {a.name: a for a in ARCHETYPES}
