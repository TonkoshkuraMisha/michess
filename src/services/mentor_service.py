# --- FILE: src/services/mentor_service.py ---
"""
Детектор шахматных мотивов для наставника.

Возвращает **факты**, а не текст: код мотива, сторону, которой он выгоден, ключевое поле, цели и числовое
значение. Слова из фактов собирает слой шаблонов (таск 11.2). Детектор не использует движок: всё считается
по правилам на `python-chess`, поэтому результат воспроизводим и проверяется тестами на конкретных позициях.

Главный принцип — ложное срабатывание хуже пропуска: наставник, который видит «вилку» там, где её нет,
вреднее молчащего. Поэтому материальные мотивы проверяются честным разменом на поле (SEE по легальным
ходам — с учётом связок и защит), а не признаком «атакована и не защищена».

Поле ``color`` у факта — сторона, которой мотив **выгоден** (может им воспользоваться): у вилки — та, чья
фигура бьёт; у слабости последней горизонтали — соперник владельца этой горизонтали; у проходной пешки —
её владелец.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal

import chess

MotifCode = Literal[
    "hanging",            # фигуру можно взять с выигрышем материала
    "fork",               # одна фигура нападает на две цели, обе не уберечь
    "pin_absolute",       # связка: за фигурой король — ходить ею нельзя
    "pin_relative",       # связка: за фигурой более ценная фигура
    "skewer",             # сквозной удар: ценная фигура впереди, за ней — ещё одна
    "discovered_attack",  # ход открыл линию дальнобойной фигуры на цель
    "discovered_check",   # ход открыл шах
    "double_check",       # двойной шах
    "overloaded",         # одна фигура — единственная защита двух атакованных
    "trapped",            # фигура под боем, и уйти ей некуда
    "back_rank",          # слабость последней горизонтали
    "mate_threat",        # если бы ходила сторона color, у неё был бы мат в N
    "mate_in",            # у стороны, которая ходит, есть мат в N
    "passed_pawn",        # проходная пешка
    "open_file",          # ладья на открытой вертикали
    "half_open_file",     # ладья на полуоткрытой вертикали
    "development_lag",    # отставание в развитии лёгких фигур
    "delayed_castling",   # король застрял в центре
]

# Учебные ценности фигур (в сантипешках): размен считается по ним, как его объясняют ученику.
PIECE_VALUE = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 300,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 10_000,
}

# Мотивы дебюта и середины партии считаются только до этого хода.
OPENING_MOVE_LIMIT = 20
DEVELOPMENT_MIN_MOVE = 6
CASTLING_MIN_MOVE = 10
DEVELOPMENT_LAG_MIN = 2

_MINOR_HOME = {
    chess.WHITE: {chess.B1: chess.KNIGHT, chess.G1: chess.KNIGHT, chess.C1: chess.BISHOP, chess.F1: chess.BISHOP},
    chess.BLACK: {chess.B8: chess.KNIGHT, chess.G8: chess.KNIGHT, chess.C8: chess.BISHOP, chess.F8: chess.BISHOP},
}
_KING_HOME = {chess.WHITE: chess.E1, chess.BLACK: chess.E8}
_BACK_RANK = {chess.WHITE: 0, chess.BLACK: 7}

_ROOK_STEPS = ((1, 0), (-1, 0), (0, 1), (0, -1))
_BISHOP_STEPS = ((1, 1), (1, -1), (-1, 1), (-1, -1))


@dataclass(frozen=True)
class Motif:
    """Один факт о позиции. ``targets`` — поля целей (для связки: связанная фигура, затем фигура за ней)."""

    code: MotifCode
    color: chess.Color
    square: chess.Square
    targets: tuple[chess.Square, ...] = ()
    value: int | None = None

    @property
    def key(self) -> tuple:
        """Идентичность факта для сравнения позиций до и после хода (значение не входит)."""
        return self.code, self.color, self.square, self.targets

    def to_dict(self, board: chess.Board) -> dict:
        """JSON-представление: имена полей и фигуры на них в позиции ``board``."""
        def describe(square: chess.Square) -> dict:
            piece = board.piece_at(square)
            return {"square": chess.square_name(square), "piece": piece.symbol() if piece else None}

        return {
            "code": self.code,
            "color": "white" if self.color == chess.WHITE else "black",
            **describe(self.square),
            "targets": [describe(target) for target in self.targets],
            "value": self.value,
        }


@dataclass
class MoveFacts:
    """Что изменил ход: мотивы, появившиеся в пользу сходившего, и мотивы, которые он отдал сопернику."""

    created: list[Motif] = field(default_factory=list)
    allowed: list[Motif] = field(default_factory=list)
    resolved: list[Motif] = field(default_factory=list)


# --- размен на поле ---------------------------------------------------------------------------


def _value(piece: chess.Piece | None) -> int:
    return PIECE_VALUE[piece.piece_type] if piece else 0


def _least_valuable_capture(board: chess.Board, square: chess.Square) -> chess.Move | None:
    """Легальное взятие на поле самой дешёвой фигурой стороны, которая ходит (превращение — в ферзя)."""
    best: chess.Move | None = None
    best_value = 0
    for move in board.generate_legal_captures(to_mask=chess.BB_SQUARES[square]):
        if move.promotion not in (None, chess.QUEEN):
            continue
        attacker_value = _value(board.piece_at(move.from_square))
        if best is None or attacker_value < best_value:
            best, best_value = move, attacker_value
    return best


def _see(board: chess.Board, square: chess.Square) -> int:
    """Выигрыш стороны, которая ходит, от размена на поле при лучшей игре обеих сторон (можно и не брать)."""
    move = _least_valuable_capture(board, square)
    if move is None:
        return 0
    captured = _value(board.piece_at(square))
    promotion_gain = PIECE_VALUE[chess.QUEEN] - PIECE_VALUE[chess.PAWN] if move.promotion else 0
    board.push(move)
    try:
        return max(0, captured + promotion_gain - _see(board, square))
    finally:
        board.pop()


def capture_gain(board: chess.Board, square: chess.Square) -> int | None:
    """
    Чистый выигрыш стороны, которая ходит, если она **начнёт** размен на поле (уже не может передумать
    после первого взятия). None — взять на поле нечем.
    """
    move = _least_valuable_capture(board, square)
    if move is None:
        return None
    captured = _value(board.piece_at(square))
    promotion_gain = PIECE_VALUE[chess.QUEEN] - PIECE_VALUE[chess.PAWN] if move.promotion else 0
    board.push(move)
    try:
        return captured + promotion_gain - _see(board, square)
    finally:
        board.pop()


def _as_side_to_move(board: chess.Board, color: chess.Color) -> chess.Board | None:
    """
    Копия позиции, где ходит ``color``: так считаются угрозы стороны, которая сейчас не ходит («что будет,
    если пропустить ход»). None — если пропуск хода невозможен (сторона, которая ходит, под шахом).
    """
    if board.turn == color:
        return board.copy(stack=False)
    if board.is_check():
        return None
    probe = board.copy(stack=False)
    probe.push(chess.Move.null())
    return probe


# --- геометрия ------------------------------------------------------------------------------


def _ray_squares(square: chess.Square, step: tuple[int, int]) -> Iterator[chess.Square]:
    file, rank = chess.square_file(square), chess.square_rank(square)
    while True:
        file, rank = file + step[0], rank + step[1]
        if not (0 <= file < 8 and 0 <= rank < 8):
            return
        yield chess.square(file, rank)


def _slider_steps(piece_type: chess.PieceType) -> tuple[tuple[int, int], ...]:
    if piece_type == chess.ROOK:
        return _ROOK_STEPS
    if piece_type == chess.BISHOP:
        return _BISHOP_STEPS
    if piece_type == chess.QUEEN:
        return _ROOK_STEPS + _BISHOP_STEPS
    return ()


def _first_two_on_ray(board: chess.Board, square: chess.Square, step: tuple[int, int]) -> list[chess.Square]:
    """Первые две фигуры (любого цвета) на луче от поля."""
    found: list[chess.Square] = []
    for target in _ray_squares(square, step):
        if board.piece_at(target):
            found.append(target)
            if len(found) == 2:
                break
    return found


def _is_defended(board: chess.Board, square: chess.Square) -> bool:
    piece = board.piece_at(square)
    return piece is not None and bool(board.attackers(piece.color, square))


# --- мотивы позиции ---------------------------------------------------------------------------


def _hanging(board: chess.Board) -> list[Motif]:
    """Фигуры, которые сторона может взять с выигрышем материала (для обеих сторон)."""
    found: list[Motif] = []
    for attacker in (chess.WHITE, chess.BLACK):
        probe = _as_side_to_move(board, attacker)
        if probe is None:
            continue
        for square in chess.SquareSet(board.occupied_co[not attacker]):
            piece = board.piece_at(square)
            if piece is None or piece.piece_type == chess.KING:
                continue
            gain = capture_gain(probe, square)
            if gain is not None and gain > 0:
                attackers = tuple(sorted(probe.attackers(attacker, square)))
                found.append(Motif("hanging", attacker, square, attackers, gain))
    return found


def _loose_target(board: chess.Board, attacker_square: chess.Square, target: chess.Square) -> bool:
    """Цель, на которую нападение реально опасно: король, более ценная фигура или незащищённая фигура."""
    piece = board.piece_at(target)
    if piece is None:
        return False
    if piece.piece_type == chess.KING:
        return True
    if piece.piece_type == chess.PAWN:
        return False
    return _value(piece) > _value(board.piece_at(attacker_square)) or not _is_defended(board, target)


def _forks(board: chess.Board) -> list[Motif]:
    """
    Вилки стороны, которая только что сходила: её фигура нападает на две цели или больше, и соперник не
    может просто взять эту фигуру с выигрышем. Для стороны, которая ходит, нападение на две фигуры — это
    уже не вилка, а возможность взять одну из них (мотив ``hanging``).
    """
    forker = not board.turn
    found: list[Motif] = []
    for square in chess.SquareSet(board.occupied_co[forker]):
        piece = board.piece_at(square)
        if piece is None or piece.piece_type == chess.KING:
            continue
        targets = tuple(sorted(
            target for target in board.attacks(square)
            if board.color_at(target) == (not forker) and _loose_target(board, square, target)
        ))
        if len(targets) < 2:
            continue
        gain = capture_gain(board, square)
        if gain is not None and gain > 0:
            continue  # вилочную фигуру просто снимут
        found.append(Motif("fork", forker, square, targets))
    return found


def _slider_can_be_taken(board: chess.Board, slider_square: chess.Square, victim: chess.Color) -> bool:
    """
    Сторона-жертва может снять связывающую фигуру хотя бы с равным разменом — тогда связки по сути нет
    (ферзь против незащищённого ферзя — это предложение размена, а не сквозной удар).
    """
    probe = _as_side_to_move(board, victim)
    if probe is None:
        return False
    gain = capture_gain(probe, slider_square)
    return gain is not None and gain >= 0


def _pins_and_skewers(board: chess.Board) -> list[Motif]:
    found: list[Motif] = []
    for square in chess.SquareSet(board.occupied):
        slider = board.piece_at(square)
        if slider is None:
            continue
        for step in _slider_steps(slider.piece_type):
            pieces = _first_two_on_ray(board, square, step)
            if len(pieces) < 2:
                continue
            front_square, back_square = pieces
            front, back = board.piece_at(front_square), board.piece_at(back_square)
            if front is None or back is None or front.color == slider.color or back.color == slider.color:
                continue
            if _slider_can_be_taken(board, square, front.color):
                continue
            front_value, back_value = _value(front), _value(back)
            if back.piece_type == chess.KING:
                found.append(Motif("pin_absolute", slider.color, square, (front_square, back_square)))
            elif front.piece_type == chess.KING:
                if back.piece_type != chess.PAWN:
                    found.append(Motif("skewer", slider.color, square, (front_square, back_square)))
            elif back_value > front_value and back_value > _value(slider):
                found.append(Motif("pin_relative", slider.color, square, (front_square, back_square)))
            elif front_value > back_value and back.piece_type != chess.PAWN and (
                    front_value > _value(slider) or not _is_defended(board, front_square)):
                found.append(Motif("skewer", slider.color, square, (front_square, back_square)))
    return found


def _overloaded(board: chess.Board) -> list[Motif]:
    """
    Фигура — единственный защитник двух атакованных фигур своей стороны, и обе сейчас удерживаются только
    ею (если фигуру можно взять и так, это мотив ``hanging``, а не перегрузка).
    """
    found: list[Motif] = []
    for defender_color in (chess.WHITE, chess.BLACK):
        attacker = not defender_color
        probe = _as_side_to_move(board, attacker)
        if probe is None:
            continue
        duties: dict[chess.Square, list[chess.Square]] = {}
        for square in chess.SquareSet(board.occupied_co[defender_color]):
            piece = board.piece_at(square)
            if piece is None or piece.piece_type in (chess.KING, chess.PAWN):
                continue
            if not board.attackers(attacker, square):
                continue
            gain = capture_gain(probe, square)
            if gain is None or gain > 0:
                continue
            defenders = board.attackers(defender_color, square)
            if len(defenders) == 1:
                duties.setdefault(next(iter(defenders)), []).append(square)
        for defender, guarded in duties.items():
            defender_piece = board.piece_at(defender)
            if len(guarded) >= 2 and defender_piece and defender_piece.piece_type != chess.KING:
                found.append(Motif("overloaded", attacker, defender, tuple(sorted(guarded))))
    return found


def _trapped(board: chess.Board) -> list[Motif]:
    """
    Фигура стороны, которая ходит, под боем, и спасти её нечем: ни отступлением, ни защитой, ни взятием
    нападающего — после любого хода её выигрывают. Иначе это просто угроза (мотив ``hanging``).
    """
    found: list[Motif] = []
    owner = board.turn
    for square in chess.SquareSet(board.occupied_co[owner]):
        piece = board.piece_at(square)
        if piece is None or piece.piece_type in (chess.KING, chess.PAWN):
            continue
        probe = _as_side_to_move(board, not owner)
        if probe is None:
            continue
        gain = capture_gain(probe, square)
        if gain is None or gain <= 0:
            continue
        safe = False
        for move in list(board.legal_moves):
            # Ход со взятием окупается, если потом отдаётся не больше взятого.
            taken = _value(board.piece_at(move.to_square)) if board.is_capture(move) else 0
            where = move.to_square if move.from_square == square else square
            board.push(move)
            try:
                after = capture_gain(board, where)
                if after is None or after <= taken:
                    safe = True
            finally:
                board.pop()
            if safe:
                break
        if not safe:
            found.append(Motif("trapped", not owner, square, (), _value(piece)))
    return found


def _back_rank(board: chess.Board) -> list[Motif]:
    """
    Король на последней горизонтали без «форточки», а тяжёлая фигура соперника уже бьёт поле этой
    горизонтали, откуда даст шах, где её не возьмёт король и которое больше никто не защищает. Просто
    «пешки f, g, h не двигались» мотивом не считается.
    """
    found: list[Motif] = []
    for owner in (chess.WHITE, chess.BLACK):
        king = board.king(owner)
        if king is None or chess.square_rank(king) != _BACK_RANK[owner]:
            continue
        enemy = not owner
        forward = 1 if owner == chess.WHITE else -1
        escape_rank = _BACK_RANK[owner] + forward
        has_luft = False
        for file in range(max(0, chess.square_file(king) - 1), min(7, chess.square_file(king) + 1) + 1):
            escape = chess.square(file, escape_rank)
            if board.color_at(escape) != owner and not board.attackers(enemy, escape):
                has_luft = True
                break
        if has_luft:
            continue
        heavy = board.pieces(chess.ROOK, enemy) | board.pieces(chess.QUEEN, enemy)
        weak: list[chess.Square] = []
        for file in range(8):
            square = chess.square(file, _BACK_RANK[owner])
            if board.color_at(square) == owner:
                continue
            enemy_attackers = board.attackers(enemy, square)
            if not any(attacker in heavy for attacker in enemy_attackers):
                continue
            if chess.between(square, king) & board.occupied:
                continue  # с этого поля шаха не будет: между ним и королём есть фигуры
            if board.attackers(owner, square) - chess.SquareSet(chess.BB_SQUARES[king]):
                continue  # поле защищает не только король
            if square in board.attacks(king) and len(enemy_attackers) < 2:
                continue  # король просто возьмёт пришедшую фигуру
            weak.append(square)
        if weak:
            found.append(Motif("back_rank", enemy, king, tuple(weak)))
    return found


def _mate_in_one(board: chess.Board) -> chess.Move | None:
    for move in board.legal_moves:
        board.push(move)
        try:
            if board.is_checkmate():
                return move
        finally:
            board.pop()
    return None


def _mate_in_two_by_checks(board: chess.Board) -> chess.Move | None:
    """Мат в 2 хода, начинающийся с шаха: полный перебор тихих первых ходов на Python слишком медленный."""
    for move in board.legal_moves:
        if not board.gives_check(move):
            continue
        board.push(move)
        try:
            replies = list(board.legal_moves)
            if replies and all(_mates_after(board, reply) for reply in replies):
                return move
        finally:
            board.pop()
    return None


def _mates_after(board: chess.Board, reply: chess.Move) -> bool:
    board.push(reply)
    try:
        return _mate_in_one(board) is not None
    finally:
        board.pop()


def _mates(board: chess.Board) -> list[Motif]:
    found: list[Motif] = []
    if board.is_game_over():
        return found
    mover = board.turn
    mate = _mate_in_one(board)
    if mate is not None:
        found.append(Motif("mate_in", mover, mate.from_square, (mate.to_square,), 1))
    else:
        mate = _mate_in_two_by_checks(board)
        if mate is not None:
            found.append(Motif("mate_in", mover, mate.from_square, (mate.to_square,), 2))

    probe = _as_side_to_move(board, not mover)
    if probe is not None:
        threat = _mate_in_one(probe)
        if threat is not None:
            found.append(Motif("mate_threat", not mover, threat.from_square, (threat.to_square,), 1))
    return found


def _passed_pawns(board: chess.Board) -> list[Motif]:
    found: list[Motif] = []
    for color in (chess.WHITE, chess.BLACK):
        enemy_pawns = board.pieces(chess.PAWN, not color)
        forward = 1 if color == chess.WHITE else -1
        for square in board.pieces(chess.PAWN, color):
            file, rank = chess.square_file(square), chess.square_rank(square)
            blocked = any(
                chess.square_file(pawn) in (file - 1, file, file + 1)
                and (chess.square_rank(pawn) - rank) * forward > 0
                for pawn in enemy_pawns
            )
            if not blocked:
                to_promotion = (7 - rank) if color == chess.WHITE else rank
                found.append(Motif("passed_pawn", color, square, (), to_promotion))
    return found


def _files(board: chess.Board) -> list[Motif]:
    found: list[Motif] = []
    for color in (chess.WHITE, chess.BLACK):
        # Только ладьи: ферзь ходит и по диагоналям, и «ферзь на открытой линии» ученику ничего не объясняет.
        for square in board.pieces(chess.ROOK, color):
            file_mask = chess.BB_FILES[chess.square_file(square)]
            own_pawns = board.pieces_mask(chess.PAWN, color) & file_mask
            enemy_pawns = board.pieces_mask(chess.PAWN, not color) & file_mask
            if not own_pawns and not enemy_pawns:
                found.append(Motif("open_file", color, square))
            elif not own_pawns:
                found.append(Motif("half_open_file", color, square))
    return found


def _undeveloped(board: chess.Board, color: chess.Color) -> int:
    return sum(
        1 for square, piece_type in _MINOR_HOME[color].items()
        if board.piece_type_at(square) == piece_type and board.color_at(square) == color
    )


def _opening(board: chess.Board) -> list[Motif]:
    found: list[Motif] = []
    move_number = board.fullmove_number
    if not DEVELOPMENT_MIN_MOVE <= move_number <= OPENING_MOVE_LIMIT:
        return found
    for color in (chess.WHITE, chess.BLACK):
        lag = _undeveloped(board, color) - _undeveloped(board, not color)
        if lag >= DEVELOPMENT_LAG_MIN:
            king = board.king(color)
            if king is not None:
                found.append(Motif("development_lag", not color, king, (), lag))

        king = board.king(color)
        if (
                move_number >= CASTLING_MIN_MOVE
                and king == _KING_HOME[color]
                and board.pieces(chess.QUEEN, not color)
                and any(
                    not (board.pieces_mask(chess.PAWN, color) & chess.BB_FILES[file])
                    for file in (3, 4)  # вертикали d и e
                )
        ):
            found.append(Motif("delayed_castling", not color, king))
    return found


def detect_motifs(board: chess.Board) -> list[Motif]:
    """
    Все мотивы позиции для обеих сторон, в стабильном порядке. После мата или пата мотивов нет: «вилка»
    ладьёй, давшей мат, ученику ничего не объясняет.
    """
    if board.is_game_over():
        return []
    motifs = [
        *_mates(board),
        *_hanging(board),
        *_forks(board),
        *_pins_and_skewers(board),
        *_overloaded(board),
        *_trapped(board),
        *_back_rank(board),
        *_passed_pawns(board),
        *_files(board),
        *_opening(board),
    ]
    unique: dict[tuple, Motif] = {}
    for motif in motifs:
        unique.setdefault(motif.key, motif)
    return list(unique.values())


# --- мотивы хода ------------------------------------------------------------------------------


def _discoveries(board_before: chess.Board, move: chess.Move, board_after: chess.Board) -> list[Motif]:
    """Ход открыл линию своей дальнобойной фигуре: вскрытое нападение, вскрытый шах, двойной шах."""
    mover = board_before.turn
    found: list[Motif] = []
    enemy_king = board_after.king(not mover)
    checkers = board_after.checkers() if enemy_king is not None else chess.SquareSet()
    for square in chess.SquareSet(board_after.occupied_co[mover]):
        if square == move.to_square:
            continue
        piece = board_after.piece_at(square)
        if piece is None or not _slider_steps(piece.piece_type):
            continue
        before = board_before.attacks(square)
        for target in board_after.attacks(square):
            if target in before or board_after.color_at(target) != (not mover):
                continue
            if move.from_square not in chess.SquareSet(chess.between(square, target)):
                continue
            target_piece = board_after.piece_at(target)
            if target_piece is not None and target_piece.piece_type == chess.KING:
                code: MotifCode = "double_check" if len(checkers) > 1 else "discovered_check"
                found.append(Motif(code, mover, square, (target, move.to_square)))
            elif _loose_target(board_after, square, target):
                found.append(Motif("discovered_attack", mover, square, (target,)))
    return found


def analyze_move(board_before: chess.Board, move: chess.Move) -> MoveFacts:
    """
    Что изменил ход: ``created`` — новые мотивы в пользу сходившего (в том числе вскрытия, которые видны
    только по самому ходу), ``allowed`` — новые мотивы в пользу соперника, ``resolved`` — мотивы, которых
    после хода не стало.
    """
    if move not in board_before.legal_moves:
        raise ValueError(f"Нелегальный ход {move.uci()} в позиции {board_before.fen()}")
    mover = board_before.turn
    before = {motif.key: motif for motif in detect_motifs(board_before)}
    board_after = board_before.copy(stack=False)
    board_after.push(move)
    after_list = detect_motifs(board_after)
    if not board_after.is_game_over():
        after_list += _discoveries(board_before, move, board_after)
    after: dict[tuple, Motif] = {}
    for motif in after_list:
        after.setdefault(motif.key, motif)

    facts = MoveFacts()
    for key, motif in after.items():
        if key in before:
            continue
        (facts.created if motif.color == mover else facts.allowed).append(motif)
    facts.resolved = [motif for key, motif in before.items() if key not in after]
    return facts
