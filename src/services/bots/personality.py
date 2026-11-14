# --- FILE: src/services/bots/personality.py ---
"""
Параметрическая модель соперника: игрок задаёт характер ползунками, сервер собирает из них стиль.

Честно о том, как это работает: ходы оценивает Stockfish (до 8 линий MultiPV) или статический
анализатор, если движка нет. Ползунки и веса фигур оценку движка НЕ меняют — они дают бонусы
кандидатам внутри окна blunder_guard_cp от лучшего хода (правила src/services/bots/style.py).
Это не «свой движок», а выбор среди хороших ходов по вкусу персоналии.

Сила: Stockfish ослабляется через UCI_Elo только начиная с 1320. Ниже движок работает на минимуме,
а слабость добавляют управляемые ошибки — с вероятностью, растущей к 600, выбирается одна из более
слабых линий. Глубину и время поиска задаёт сервер по target_elo (не больше 8 полуходов и 0,5 с).
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import chess
from pydantic import BaseModel, ConfigDict, Field

from src.services.bots.base import BookEntry, HistoricalBot
from src.services.bots.style import (
    ALWAYS,
    CAPTURE,
    CASTLING,
    CENTER_SQUARES,
    CHECK,
    EXTENDED_CENTER,
    FROM_BACK_RANK,
    MINOR_PIECES,
    Cond,
    MoveContext,
    Rule,
    Style,
    by_move,
    mobility_count,
    pawn_structure_delta,
    piece,
    to,
)

MIN_TARGET_ELO = 600
MAX_TARGET_ELO = 2800
STOCKFISH_MIN_ELO = 1320
MAX_SEARCH_DEPTH = 8
MAX_SEARCH_TIME_S = 0.5
# Вероятность управляемой ошибки по целевому рейтингу — поправочная кривая по калибровке 14.11 (лог
# 2026-11-13_asymmetric_window.log), а не прямая: измеренная сила падает с долей ошибок нелинейно (0,05 → 1398,
# 0,15 → 1251, 0,29 → 737, 0,43 → 471), и линейная доля делала цели 1100–1250 сильнее, а 700–900 — слабее заявленного.
# Выше 1320 Stockfish на минимальном UCI_Elo с окном стиля играет около 1420, поэтому ошибки сходят на нет к 1450.
# Между точками — линейно; после правки — перекалибровка (scripts/calibrate_bots.py --only ...).
# Уточнение по второму прогону (2026-11-14_weak_curve.log): две точки на каждого слабого бота дают долю ошибок,
# при которой он играет на заявленную силу, — почти прямая 0,355 (700) → 0,10 (1250).
ERROR_RATE_CURVE: tuple[tuple[int, float], ...] = (
    (600, 0.40), (700, 0.355), (900, 0.265), (1100, 0.175), (1250, 0.10), (1320, 0.07), (1450, 0.0),
)
MAX_ERROR_RATE = ERROR_RATE_CURVE[0][1]
# Доля грубых зевков (случайный легальный ход) среди управляемых ошибок ниже 1320.
BLUNDER_SHARE = 1 / 3
# randomness 100 → разброс ±40 сп между равными кандидатами.
JITTER_CP_PER_RANDOMNESS = 0.4

STANDARD_VALUES = {chess.PAWN: 1.0, chess.KNIGHT: 3.0, chess.BISHOP: 3.0, chess.ROOK: 5.0, chess.QUEEN: 9.0}


class PieceValues(BaseModel):
    """Как персоналия ценит фигуры (в пешках). Влияет на выбор разменов, не на оценку движка."""

    model_config = ConfigDict(extra="forbid")

    pawn: float = Field(1.0, ge=0.5, le=1.5)
    knight: float = Field(3.0, ge=2.0, le=4.5)
    bishop: float = Field(3.0, ge=2.0, le=4.5)
    rook: float = Field(5.0, ge=3.5, le=6.5)
    queen: float = Field(9.0, ge=7.0, le=11.0)

    def of(self, piece_type: int | None) -> float:
        return {
            chess.PAWN: self.pawn, chess.KNIGHT: self.knight, chess.BISHOP: self.bishop,
            chess.ROOK: self.rook, chess.QUEEN: self.queen,
        }.get(piece_type or 0, 0.0)

    def is_standard(self) -> bool:
        return all(self.of(pt) == value for pt, value in STANDARD_VALUES.items())


class BotPersonalityConfig(BaseModel):
    """
    Характер соперника. Ползунки 0..200: 100 — обычный вес признака, 0 — признак не учитывается,
    200 — удвоенный. aggression: +100 — шахи, жертвы, игра против короля; -100 — профилактика и тихие ходы.
    """

    model_config = ConfigDict(extra="forbid")

    aggression: int = Field(0, ge=-100, le=100)
    center_control: int = Field(100, ge=0, le=200)
    mobility: int = Field(100, ge=0, le=200)
    king_safety: int = Field(100, ge=0, le=200)
    pawn_structure: int = Field(100, ge=0, le=200)
    piece_values: PieceValues = Field(default_factory=PieceValues)
    randomness: int = Field(20, ge=0, le=100)
    blunder_guard_cp: int = Field(120, ge=0, le=400)
    target_elo: int = Field(1500, ge=MIN_TARGET_ELO, le=MAX_TARGET_ELO)


# --- Сила ----------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Strength:
    uci_elo: int
    skill_level: int
    depth: int
    time_limit: float
    error_rate: float


def _error_rate(elo: int) -> float:
    for (lo_elo, lo_rate), (hi_elo, hi_rate) in zip(ERROR_RATE_CURVE, ERROR_RATE_CURVE[1:], strict=False):
        if elo <= hi_elo:
            share = (max(elo, lo_elo) - lo_elo) / (hi_elo - lo_elo)
            return lo_rate + (hi_rate - lo_rate) * share
    return 0.0


def strength_for(target_elo: int) -> Strength:
    """Параметры поиска по целевому рейтингу; клиент их не задаёт."""
    elo = max(MIN_TARGET_ELO, min(MAX_TARGET_ELO, target_elo))
    t = (elo - MIN_TARGET_ELO) / (MAX_TARGET_ELO - MIN_TARGET_ELO)
    error_rate = _error_rate(elo)
    return Strength(
        uci_elo=max(STOCKFISH_MIN_ELO, elo),
        skill_level=round(20 * t),
        depth=min(MAX_SEARCH_DEPTH, round(4 + 4 * t)),
        time_limit=min(MAX_SEARCH_TIME_S, round(0.15 + 0.35 * t, 3)),
        error_rate=round(error_rate, 4),
    )


# --- Признаки ходов для ползунков -------------------------------------------------------------

def _sacrifice(c: MoveContext) -> bool:
    """Фигура встаёт под бой и стоит дороже взятого (незащищённая пешка — тоже жертва)."""
    if c.piece is None or c.piece.piece_type == chess.KING or not c.destination_attacked:
        return False
    moved = STANDARD_VALUES[c.piece.piece_type]
    taken = STANDARD_VALUES.get(c.captured_piece_type or 0, 0.0)
    if moved <= taken:
        return False
    defended = c.board_after.is_attacked_by(c.us, c.move.to_square)
    return not defended or c.piece.piece_type != chess.PAWN


def _near_enemy_king(c: MoveContext) -> bool:
    king = c.board.king(not c.us)
    return king is not None and chess.square_distance(c.move.to_square, king) <= 2


def _queens_on_board(c: MoveContext) -> bool:
    return bool(c.board.pieces(chess.QUEEN, chess.WHITE)) and bool(c.board.pieces(chess.QUEEN, chess.BLACK))


def _shelter_pawn_push(c: MoveContext) -> bool:
    """Ход пешкой из укрытия короля, стоящего на фланге первой горизонтали."""
    if c.piece is None or c.piece.piece_type != chess.PAWN:
        return False
    king = c.board.king(c.us)
    if king is None or chess.square_rank(king) != (0 if c.us == chess.WHITE else 7):
        return False
    king_file = chess.square_file(king)
    if king_file in (3, 4):
        return False
    return abs(chess.square_file(c.move.from_square) - king_file) <= 1


SACRIFICE = Cond(_sacrifice)
NEAR_ENEMY_KING = Cond(_near_enemy_king)
QUEENS_ON = Cond(_queens_on_board)
SHELTER_PAWN_PUSH = Cond(_shelter_pawn_push)
QUIET = ~CHECK & ~CAPTURE


def _active_moves(board: chess.Board, color: chess.Color) -> int:
    """Взятия и шахи, доступные стороне color, — её угрозы."""
    probe = board
    if board.turn != color:
        probe = board.copy(stack=False)
        probe.turn = color
        probe.ep_square = None
    return sum(1 for m in probe.pseudo_legal_moves if probe.is_capture(m) or probe.gives_check(m))


def _prophylaxis(c: MoveContext) -> float:
    """
    Профилактика: сколько угроз (взятий и шахов) ход отнимает у соперника — главный вклад,
    и насколько сокращает его подвижность — дополнительный.
    """
    them = not c.us
    threats_removed = _active_moves(c.board, them) - _active_moves(c.board_after, them)
    squares_removed = mobility_count(c.board, them) - mobility_count(c.board_after, them)
    return 6.0 * max(0, min(6, threats_removed)) + 1.0 * max(0, min(10, squares_removed))


def _mobility_gain(c: MoveContext) -> float:
    """Прирост числа собственных ходов (от -20 до +20)."""
    gain = mobility_count(c.board_after, c.us) - mobility_count(c.board, c.us)
    return float(max(-20, min(20, gain)))


def _material_perception(values: PieceValues):
    def bonus(c: MoveContext) -> float:
        # Сдвиг относительно стандартной шкалы: взятие фигуры, которую персоналия ценит выше,
        # привлекательнее; поставить под бой «дорогую» для неё фигуру — менее привлекательно.
        total = 0.0
        if c.captured_piece_type is not None:
            total += 100.0 * (values.of(c.captured_piece_type) - STANDARD_VALUES[c.captured_piece_type])
        if c.piece is not None and c.piece.piece_type != chess.KING and c.destination_attacked:
            total -= 100.0 * (values.of(c.piece.piece_type) - STANDARD_VALUES[c.piece.piece_type])
        return total

    return bonus


def _scaled(weight: float, feature):
    return lambda c: weight * feature(c)


def build_style(config: BotPersonalityConfig) -> Style:
    """Правила стиля из ползунков; признаки с нулевым весом не считаются вовсе."""
    rules: list[Rule] = []
    a = config.aggression / 100.0
    if a > 0:
        rules += [
            Rule(CHECK, 40.0 * a, "personality.check"),
            Rule(SACRIFICE, 45.0 * a, "personality.sacrifice"),
            Rule(CAPTURE & ~SACRIFICE, 12.0 * a, "personality.openByTrade"),
            Rule(NEAR_ENEMY_KING & ~piece(chess.KING), 15.0 * a, "personality.kingHunt"),
        ]
    elif a < 0:
        calm = -a
        rules += [
            Rule(QUIET, _scaled(calm, _prophylaxis), "personality.prophylaxis"),
            Rule(CHECK | CAPTURE, -10.0 * calm),
        ]

    center = config.center_control / 100.0
    if center:
        rules += [
            Rule(to(CENTER_SQUARES), 22.0 * center, "personality.center"),
            Rule(to(EXTENDED_CENTER) & ~to(CENTER_SQUARES), 10.0 * center, "personality.centerSpace"),
        ]

    mobility = config.mobility / 100.0
    if mobility:
        rules += [
            Rule(
                piece(*MINOR_PIECES) & by_move(15) & FROM_BACK_RANK, 25.0 * mobility,
                "personality.develop",
            ),
            Rule(ALWAYS, _scaled(1.5 * mobility, _mobility_gain), "personality.activate"),
        ]

    king = config.king_safety / 100.0
    if king:
        rules += [
            Rule(CASTLING, 40.0 * king, "personality.castle"),
            Rule(piece(chess.KING) & ~CASTLING & QUEENS_ON, -25.0 * king),
            Rule(SHELTER_PAWN_PUSH & QUEENS_ON, -15.0 * king),
        ]

    pawns = config.pawn_structure / 100.0
    if pawns:
        rules.append(Rule(ALWAYS, _scaled(pawns, pawn_structure_delta), "personality.pawns"))

    if not config.piece_values.is_standard():
        rules.append(Rule(ALWAYS, _material_perception(config.piece_values), "personality.trade"))

    return Style("personality", *rules, note_by_weight=True)


def default_comment_for(config: BotPersonalityConfig) -> str:
    if config.aggression >= 30:
        return "personality.seekAttack"
    if config.aggression <= -30:
        return "personality.calm"
    return "personality.positional"


class PersonalityBot(HistoricalBot):
    """Соперник с характером из BotPersonalityConfig: без дебютной книги, с силой по target_elo."""

    bot_id = "custom"
    engine_source_name = "personality_engine"
    multipv = 8
    opening_book: dict[str, list[BookEntry]] = {}

    def __init__(self, config: BotPersonalityConfig, stockfish_path: str | None = None):
        self.config = config
        self.strength = strength_for(config.target_elo)
        super().__init__(
            stockfish_path,
            skill_level=self.strength.skill_level,
            uci_elo=self.strength.uci_elo,
            search_depth=self.strength.depth,
        )
        self.time_limit = self.strength.time_limit
        self.blunder_guard_cp = float(config.blunder_guard_cp)
        self.jitter_range = config.randomness * JITTER_CP_PER_RANDOMNESS
        self.style = build_style(config)
        self.default_comment = default_comment_for(config)

    def _select_move(
            self, board: chess.Board, scores: dict[chess.Move, float], reference: chess.Move | None = None,
    ) -> tuple[chess.Move, str | None]:
        # Управляемая ошибка у слабых (кривая ERROR_RATE_CURVE). Линии MultiPV часто почти равны лучшей — «ошибка»
        # среди них почти ничего не стоила (калибровка 13.11: «Торопыга» с целью 700 играл на ~1150). Теперь ошибка —
        # ход из худшей половины линий, а в BLUNDER_SHARE случаев — случайный легальный ход: грубый зевок, как у новичка.
        if self.strength.error_rate and len(scores) > 1 and random.random() < self.strength.error_rate:
            if random.random() < BLUNDER_SHARE:
                weaker = random.choice(list(board.legal_moves))
            else:
                ranked = sorted(scores, key=lambda mv: scores[mv], reverse=True)
                weaker = random.choice(ranked[max(1, len(ranked) // 2):])
            return weaker, self.evaluate_style_bonus(board, weaker)[1]
        return super()._select_move(board, scores, reference)
