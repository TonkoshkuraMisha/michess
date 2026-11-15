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
    # Соперники для новичков (таск 21.4): 300–1200, у каждого — узнаваемая слабость или дебютная привычка.
    Archetype("blunderer", "Gaper", _cfg(habits=["hangs_pieces"], randomness=90, blunder_guard_cp=400, target_elo=350)),
    Archetype("queen_rusher", "Queen Rusher",
              _cfg(habits=["early_queen"], opening_style="early_queen", aggression=40, target_elo=450)),
    Archetype("trap_victim", "Simpleton", _cfg(opening_style="trap_victim", randomness=60, target_elo=500)),
    Archetype("pawn_grabber", "Pawn Eater", _cfg({"pawn": 1.5}, habits=["pawn_grabber"], target_elo=550)),
    Archetype("knight_rider", "Knight Rider", _cfg({"knight": 4.5}, habits=["knight_lover"], target_elo=600)),
    Archetype("homebody", "Homebody", _cfg(habits=["no_castling"], king_safety=40, target_elo=650)),
    Archetype("trader", "Trader",
              _cfg(habits=["trades_all"], opening_style="drawish", draw_attitude=60, target_elo=750)),
    Archetype("oddball", "Oddball", _cfg(opening_style="offbeat", randomness=70, target_elo=800)),
    Archetype("trapper", "Trapper", _cfg(opening_style="trapper", aggression=40, target_elo=900)),
    Archetype("gambiteer", "Gambiteer", _cfg(opening_style="gambit", aggression=60, king_safety=70, target_elo=1000)),
    Archetype("peacemaker", "Peacemaker",
              _cfg(opening_style="drawish", draw_attitude=100, aggression=-40, target_elo=1100)),
    Archetype("pawn_pusher", "Pawn Pusher", _cfg(passed_pawns=200, pawn_structure=140, target_elo=1200)),
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

# Соперники для новичков в лестницу (10.4) не входят: ступень игрока — индекс в списке ступеней, и новые ступени
# внизу сдвинули бы прогресс всех, кто уже на лестнице. Включать их — вместе с миграцией ladder_step.
BEGINNER_IDS = frozenset({"blunderer", "queen_rusher", "trap_victim", "pawn_grabber", "knight_rider", "homebody",
                          "trader", "oddball", "trapper", "gambiteer", "peacemaker", "pawn_pusher"})
LADDER_ARCHETYPES = tuple(a for a in ARCHETYPES if a.id not in BEGINNER_IDS)

ARCHETYPES_BY_ID = {a.id: a for a in ARCHETYPES}
ARCHETYPES_BY_KEY = {a.key: a for a in ARCHETYPES}
