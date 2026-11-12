# --- FILE: src/services/bots/archetypes.py ---
"""
Готовые архетипы мастерской соперников (таск 10.3) — источник правды на сервере: их калибрует
scripts/calibrate_bots.py, по ним строится клубная лестница (таск 10.4), фронтенд получает их через
GET /bots/catalog. Персонажи вымышленные — не реальные люди и не герои чужих программ.

Сервер знает только id и английское имя для PGN; имя и описание на языке игрока — в каталогах клиента
(archetypes.<id>.name / .bio). В базе партия с архетипом лестницы хранит personality_name «archetype:<id>».
"""

from dataclasses import dataclass

from src.services.bots.personality import BotPersonalityConfig, PieceValues

ARCHETYPE_PREFIX = "archetype:"


@dataclass(frozen=True)
class Archetype:
    id: str
    pgn_name: str
    config: BotPersonalityConfig

    @property
    def key(self) -> str:
        """Ключ в калибровке, на лестнице и в games.personality_name."""
        return f"{ARCHETYPE_PREFIX}{self.id}"


def _cfg(piece_values: dict | None = None, **fields) -> BotPersonalityConfig:
    return BotPersonalityConfig(piece_values=PieceValues(**(piece_values or {})), **fields)


ARCHETYPES: tuple[Archetype, ...] = (
    Archetype(
        "rusher",
        "Rusher",
        _cfg(aggression=70, king_safety=30, mobility=60, randomness=80, blunder_guard_cp=320, target_elo=700),
    ),
    Archetype(
        "quiet",
        "Quiet One",
        _cfg(aggression=-70, king_safety=160, randomness=40, blunder_guard_cp=220, target_elo=900),
    ),
    Archetype(
        "pawn_keeper",
        "Pawn Keeper",
        _cfg({"pawn": 1.4}, pawn_structure=200, center_control=140, target_elo=1100),
    ),
    Archetype(
        "cavalier",
        "Cavalier",
        _cfg({"knight": 4.0, "bishop": 2.6}, mobility=160, aggression=30, target_elo=1250),
    ),
    Archetype(
        "centralist",
        "Centralist",
        _cfg(center_control=200, mobility=120, randomness=15, target_elo=1400),
    ),
    Archetype(
        "fortress",
        "Fortress",
        _cfg(aggression=-60, king_safety=200, pawn_structure=140, randomness=10, target_elo=1550),
    ),
    Archetype(
        "adventurer",
        "Adventurer",
        _cfg(aggression=95, king_safety=60, randomness=60, blunder_guard_cp=260, target_elo=1650),
    ),
    Archetype(
        "strategist",
        "Strategist",
        _cfg(aggression=-30, center_control=150, pawn_structure=160, randomness=10, blunder_guard_cp=90,
             target_elo=1800),
    ),
    Archetype(
        "hunter",
        "Hunter",
        _cfg(aggression=100, king_safety=50, mobility=150, blunder_guard_cp=180, target_elo=2000),
    ),
    Archetype(
        "combinator",
        "Combinator",
        _cfg(aggression=80, mobility=160, randomness=10, blunder_guard_cp=150, target_elo=2200),
    ),
)

ARCHETYPES_BY_ID = {a.id: a for a in ARCHETYPES}
ARCHETYPES_BY_KEY = {a.key: a for a in ARCHETYPES}
