# --- FILE: src/services/drill_generator.py ---
"""
Упражнения-генераторы (таск 13.7): позиции не из базы, а расставляются по seed. Матрица «вид × фигура»:

* capture — взять незащищённую фигуру соперника;
* fork — вилка: ход на безопасное поле, с которого бьются две цели (король, незащищённая или более ценная фигура);
* check — шах, после которого шахующую фигуру нельзя взять;
* pin — связка: после хода фигура соперника связана (абсолютно или с ферзём);
* safe — фигура под боем: единственное поле, где её не взять;
* escape — соперник грозит матом в 1 (фигурой данного вида): единственный ход, который спасает;
* mate1 — мат в 1 данной фигурой;
* mate2 — мат в 2: единственный первый ход, после любого ответа — мат.

Уровни 1–3 — сколько на доске фигур и отвлекающих целей. Решение проверяется перебором: генератор принимает позицию,
только если верный ответ ровно один (``solutions``); упражнение задаётся (вид, фигура, уровень, seed) — сервер не
хранит позиций и в любой момент восстанавливает упражнение для проверки ответа. Цвет решающего меняется по seed.
"""

import random
from dataclasses import dataclass

import chess

KINDS = ("capture", "fork", "check", "pin", "safe", "escape", "mate1", "mate2")
PIECES = ("q", "r", "b", "n", "x")  # x — случайная фигура
LEVELS = (1, 2, 3)
PIECE_TYPES = {"q": chess.QUEEN, "r": chess.ROOK, "b": chess.BISHOP, "n": chess.KNIGHT}
SLIDERS = (chess.QUEEN, chess.ROOK, chess.BISHOP)
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
# Сколько фигур соперника (кроме короля) и пешек ставить на уровне.
LEVEL_ENEMIES = {1: (1, 2), 2: (2, 3), 3: (3, 5)}
LEVEL_PAWNS = {1: (0, 0), 2: (0, 2), 3: (1, 3)}
MAX_ATTEMPTS = 4000


class DrillGenerationError(Exception):
    """Не удалось подобрать позицию с единственным ответом за отведённое число попыток."""


@dataclass(frozen=True)
class Drill:
    kind: str
    piece: str      # q/r/b/n — по запросу; x уже заменён на конкретную фигуру
    level: int
    seed: int       # seed, на котором позиция подобрана (по нему упражнение восстанавливается)
    fen: str
    solutions: tuple[str, ...]  # единственный верный ход (mate2 — первый ход)

    @property
    def key(self) -> str:
        return f"{self.kind}.{self.piece}.{self.level}.{self.seed}"


def supported(kind: str, piece: str) -> bool:
    """Конь не связывает; всё остальное — в матрице."""
    return kind in KINDS and piece in PIECES and not (kind == "pin" and piece == "n")


# --- критерии (для стороны, которая ходит) -------------------------------------------------------------------

def _at(board: chess.Board, square: chess.Square) -> chess.Piece:
    """Фигура на поле, где она заведомо есть (поле хода, поле фигуры решающего)."""
    piece = board.piece_at(square)
    assert piece is not None
    return piece


def _at_king(board: chess.Board) -> chess.Square:
    king = board.king(chess.BLACK)
    assert king is not None
    return king


def _value(piece: chess.Piece) -> int:
    return VALUES[piece.piece_type]


def _safe_after(board: chess.Board, move: chess.Move) -> bool:
    """После хода фигуру на поле прихода соперник взять не может."""
    after = board.copy(stack=False)
    after.push(move)
    return not after.is_attacked_by(after.turn, move.to_square)


def _targets(board: chess.Board, square: chess.Square, us: chess.Color) -> int:
    """Сколько целей бьёт фигура на square: король, незащищённая или более ценная фигура соперника."""
    attacker = _at(board, square)
    count = 0
    for target in board.attacks(square):
        victim = board.piece_at(target)
        if victim is None or victim.color == us:
            continue
        if (victim.piece_type == chess.KING or not board.is_attacked_by(not us, target)
                or _value(victim) > _value(attacker)):
            count += 1
    return count


def _capture_moves(board: chess.Board) -> list[chess.Move]:
    us = board.turn
    result = []
    for move in board.legal_moves:
        victim = board.piece_at(move.to_square)
        if victim is None or victim.color == us or victim.piece_type == chess.KING:
            continue
        if not board.is_attacked_by(not us, move.to_square):  # фигура соперника не защищена
            result.append(move)
    return result


def _fork_moves(board: chess.Board) -> list[chess.Move]:
    us = board.turn
    result = []
    for move in board.legal_moves:
        if _at(board, move.from_square).piece_type in (chess.KING, chess.PAWN) or not _safe_after(board, move):
            continue
        after = board.copy(stack=False)
        after.push(move)
        if _targets(after, move.to_square, us) >= 2:
            result.append(move)
    return result


def _check_moves(board: chess.Board) -> list[chess.Move]:
    return [m for m in board.legal_moves if board.gives_check(m) and _safe_after(board, m)]


def _pin_moves(board: chess.Board) -> list[chess.Move]:
    them = not board.turn
    result = []
    for move in board.legal_moves:
        mover = _at(board, move.from_square)
        if mover.piece_type not in SLIDERS or not _safe_after(board, move) or board.gives_check(move):
            continue
        after = board.copy(stack=False)
        after.push(move)
        if any(_pinned_by(after, sq, move.to_square, them) for sq in chess.SquareSet(after.occupied_co[them])):
            result.append(move)
    return result


def _pinned_by(board: chess.Board, square: chess.Square, pinner: chess.Square, color: chess.Color) -> bool:
    """Фигура соперника на square связана фигурой с поля pinner: на короля или на ферзя за ней."""
    piece = board.piece_at(square)
    if piece is None or piece.piece_type in (chess.KING, chess.QUEEN):
        return False
    if board.is_pinned(color, square) and pinner in board.pin(color, square):
        return True
    # Относительная связка: за фигурой на той же линии — ферзь соперника.
    between = chess.SquareSet.between(pinner, square)
    if between & board.occupied:
        return False
    if square not in board.attacks(pinner):
        return False
    ray = chess.SquareSet.ray(pinner, square)
    beyond = [sq for sq in ray if chess.square_distance(pinner, sq) > chess.square_distance(pinner, square)
              and not (chess.SquareSet.between(square, sq) & board.occupied)]
    for sq in beyond:
        behind = board.piece_at(sq)
        if behind is not None:
            return behind.color == color and behind.piece_type == chess.QUEEN and _value(piece) < 9
    return False


def _safe_moves(board: chess.Board, square: chess.Square) -> list[chess.Move]:
    return [m for m in board.legal_moves if m.from_square == square and _safe_after(board, m)]


def _has_mate_in_one(board: chess.Board) -> chess.Move | None:
    for move in board.legal_moves:
        board.push(move)
        mate = board.is_checkmate()
        board.pop()
        if mate:
            return move
    return None


def _mate_moves(board: chess.Board) -> list[chess.Move]:
    result = []
    for move in board.legal_moves:
        board.push(move)
        if board.is_checkmate():
            result.append(move)
        board.pop()
    return result


def _escape_moves(board: chess.Board) -> list[chess.Move]:
    result = []
    for move in board.legal_moves:
        board.push(move)
        if _has_mate_in_one(board) is None:
            result.append(move)
        board.pop()
    return result


def _mate_in_two_moves(board: chess.Board) -> list[chess.Move]:
    result = []
    for move in board.legal_moves:
        board.push(move)
        forced = not board.is_checkmate() and not board.is_stalemate() and board.legal_moves.count() > 0
        if forced:
            for reply in board.legal_moves:
                board.push(reply)
                ok = _has_mate_in_one(board) is not None
                board.pop()
                if not ok:
                    forced = False
                    break
        board.pop()
        if forced:
            result.append(move)
    return result


def mate_reply(board: chess.Board, first: chess.Move) -> chess.Move:
    """Ответ соперника после первого хода в мате в 2: самый «упорный» — после которого меньше всего матов."""
    after = board.copy(stack=False)
    after.push(first)

    def mates_left(reply: chess.Move) -> tuple[int, str]:
        probe = after.copy(stack=False)
        probe.push(reply)
        return len(_mate_moves(probe)), reply.uci()

    return min(after.legal_moves, key=mates_left)


def solutions_for(kind: str, board: chess.Board, key_square: chess.Square | None = None) -> list[chess.Move]:
    """Все ответы, которые засчитываются по правилу вида (упражнение корректно, если ответ один)."""
    if kind == "capture":
        return _capture_moves(board)
    if kind == "fork":
        return _fork_moves(board)
    if kind == "check":
        return _check_moves(board)
    if kind == "pin":
        return _pin_moves(board)
    if kind == "safe":
        return _safe_moves(board, key_square) if key_square is not None else []
    if kind == "escape":
        return _escape_moves(board)
    if kind == "mate1":
        return _mate_moves(board)
    if kind == "mate2":
        return _mate_in_two_moves(board)
    raise ValueError(kind)


# --- расстановка -------------------------------------------------------------------------------------------

def _random_square(rng: random.Random, board: chess.Board, *, ranks: range = range(8)) -> chess.Square:
    while True:
        square = chess.square(rng.randrange(8), rng.choice(list(ranks)))
        if board.piece_at(square) is None:
            return square


def _place_kings(rng: random.Random, board: chess.Board, *, edge_enemy: bool = False) -> tuple[chess.Square, chess.Square]:
    ours = _random_square(rng, board)
    board.set_piece_at(ours, chess.Piece(chess.KING, chess.WHITE))
    while True:
        if edge_enemy:
            file, rank = rng.choice([(rng.randrange(8), 7), (rng.choice((0, 7)), rng.randrange(4, 8))])
            theirs = chess.square(file, rank)
        else:
            theirs = _random_square(rng, board)
        if board.piece_at(theirs) is None and chess.square_distance(ours, theirs) > 1:
            board.set_piece_at(theirs, chess.Piece(chess.KING, chess.BLACK))
            return ours, theirs


def _place(rng: random.Random, board: chess.Board, piece: chess.Piece) -> chess.Square:
    ranks = range(1, 7) if piece.piece_type == chess.PAWN else range(8)
    square = _random_square(rng, board, ranks=ranks)
    board.set_piece_at(square, piece)
    return square


def _enemy_types(rng: random.Random, count: int) -> list[chess.PieceType]:
    return [rng.choice((chess.QUEEN, chess.ROOK, chess.ROOK, chess.BISHOP, chess.BISHOP, chess.KNIGHT, chess.KNIGHT))
            for _ in range(count)]


def _arrange(kind: str, piece_type: chess.PieceType, level: int, rng: random.Random) -> tuple[chess.Board, chess.Square]:
    """Случайная расстановка для вида: наш король и фигура piece_type, король и фигуры соперника. Ходят белые."""
    board = chess.Board(None)
    board.turn = chess.WHITE
    enemies = rng.randint(*LEVEL_ENEMIES[level])
    pawns = rng.randint(*LEVEL_PAWNS[level])
    mating = kind in ("mate1", "mate2")
    _place_kings(rng, board, edge_enemy=mating)
    if kind == "escape":
        # Наш король на краю за своими пешками (как в партии), угроза мата — фигурой вида piece_type соперника.
        board = chess.Board(None)
        board.turn = chess.WHITE
        file = rng.randrange(8)
        king = chess.square(file, 0)
        board.set_piece_at(king, chess.Piece(chess.KING, chess.WHITE))
        for df in (-1, 0, 1):
            if 0 <= file + df < 8 and rng.random() < 0.8:
                board.set_piece_at(chess.square(file + df, 1), chess.Piece(chess.PAWN, chess.WHITE))
        while True:
            theirs = _random_square(rng, board, ranks=range(4, 8))
            if chess.square_distance(king, theirs) > 1:
                board.set_piece_at(theirs, chess.Piece(chess.KING, chess.BLACK))
                break
        board.set_piece_at(_random_square(rng, board, ranks=range(2, 8)), chess.Piece(piece_type, chess.BLACK))
        if piece_type in (chess.BISHOP, chess.KNIGHT):
            enemies = max(enemies, 3)  # лёгкая фигура матует только с помощниками
        for t in _enemy_types(rng, enemies - 1):
            _place(rng, board, chess.Piece(t, rng.choice((chess.WHITE, chess.BLACK))))
        for _ in range(pawns):
            _place(rng, board, chess.Piece(chess.PAWN, chess.BLACK))
        return board, chess.square(0, 0)
    key = _place(rng, board, chess.Piece(piece_type, chess.WHITE))
    if mating and piece_type in (chess.BISHOP, chess.KNIGHT):
        # Мат лёгкой фигурой — только королю, зажатому своими фигурами (как спёртый мат): ставим их вплотную.
        theirs = _at_king(board)
        around = [sq for sq in chess.SquareSet(chess.BB_KING_ATTACKS[theirs]) if board.piece_at(sq) is None]
        rng.shuffle(around)
        for sq in around[:rng.randint(2, 4)]:
            rank = chess.square_rank(sq)
            blocker = (chess.PAWN if 0 < rank < 7 and rng.random() < 0.6
                       else rng.choice((chess.ROOK, chess.BISHOP, chess.KNIGHT)))
            board.set_piece_at(sq, chess.Piece(blocker, chess.BLACK))
        _place(rng, board, chess.Piece(rng.choice((chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.QUEEN)), chess.WHITE))
        enemies = 0
    if mating:
        enemies = max(0, enemies - 1)
        if kind == "mate2" or level > 1:
            _place(rng, board, chess.Piece(rng.choice((chess.ROOK, chess.BISHOP, chess.KNIGHT)), chess.WHITE))
    for t in _enemy_types(rng, enemies):
        _place(rng, board, chess.Piece(t, chess.BLACK))
    for _ in range(pawns):
        _place(rng, board, chess.Piece(chess.PAWN, rng.choice((chess.WHITE, chess.BLACK))))
    return board, key


def _valid(board: chess.Board) -> bool:
    return board.is_valid() and not board.is_check() and not board.is_game_over()


def _accept(kind: str, board: chess.Board, key: chess.Square, piece_type: chess.PieceType) -> chess.Move | None:
    """Верный ответ, если он единственный и сделан нужной фигурой (для escape — угрозу создаёт фигура вида)."""
    if kind == "safe" and not board.is_attacked_by(not board.turn, key):
        return None
    if kind == "escape":
        threat = board.copy(stack=False)
        threat.push(chess.Move.null())
        mate = _has_mate_in_one(threat)
        if mate is None or _at(threat, mate.from_square).piece_type != piece_type:
            return None
    moves = solutions_for(kind, board, key)
    if len(moves) != 1:
        return None
    move = moves[0]
    if kind != "escape" and _at(board, move.from_square).piece_type != piece_type:
        return None
    return move


def generate(kind: str, piece: str, level: int, seed: int) -> Drill:
    """Упражнение по seed: первые попытки от seed по порядку — детерминированно; seed в ответе — подобранный."""
    if not supported(kind, piece) or level not in LEVELS:
        raise ValueError(f"unsupported drill {kind}/{piece}/{level}")
    for attempt in range(MAX_ATTEMPTS):
        current = seed + attempt
        drill = build(kind, piece, level, current)
        if drill is not None:
            return drill
    raise DrillGenerationError(f"{kind}/{piece}/{level} from seed {seed}")


def build(kind: str, piece: str, level: int, seed: int) -> Drill | None:
    """Одна попытка: расстановка по seed и проверка; None — позиция не годится."""
    rng = random.Random(f"{kind}:{piece}:{level}:{seed}")
    actual = rng.choice("qrbn") if piece == "x" else piece
    if kind == "pin" and actual == "n":
        actual = rng.choice("qrb")
    board, key = _arrange(kind, PIECE_TYPES[actual], level, rng)
    if not _valid(board):
        return None
    move = _accept(kind, board, key, PIECE_TYPES[actual])
    if move is None:
        return None
    if rng.random() < 0.5:  # за чёрных — зеркально
        board = board.mirror()
        move = chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion)
    return Drill(kind=kind, piece=piece, level=level, seed=seed, fen=board.fen(), solutions=(move.uci(),))


def restore(key: str) -> Drill:
    """Упражнение по ключу «вид.фигура.уровень.seed» (ключ выдаёт сервер — seed в нём уже подобранный)."""
    try:
        kind, piece, level, seed = key.split(".")
        drill = build(kind, piece, int(level), int(seed))
    except (ValueError, KeyError):
        drill = None
    if drill is None:
        raise ValueError(f"invalid drill key {key}")
    return drill
