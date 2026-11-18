# --- FILE: src/services/positional.py ---
"""
Позиционные признаки (таск B.4): о чём сказать, когда тактики нет. Правила простые и проверяемые, без движка —
наставник называет признак и поле, а не оценку:

* king_center — миттельшпиль (с 8-го хода, не эндшпиль, у соперника есть ферзь или фигур не меньше чем на 10
  очков), а король стороны ещё на первой горизонтали на вертикали d или e (право рокировки не проверяется);
* king_holes — король на фланге (на первой горизонтали, не на d/e), а на третьей горизонтали перед ним (вертикали
  короля ±1) поле, которое своя пешка уже никогда не защитит; у соперника есть слон этого цвета, у стороны — нет;
* passed_enemy / passed_own — проходная пешка соперника (не заблокирована) или своя, дошедшая хотя бы до четвёртой
  горизонтали от своего края; называется самая продвинутая;
* king_active — эндшпиль (ферзей нет, лёгких и тяжёлых фигур мало), а король на своих двух первых горизонталях;
* open_file — вертикаль без пешек, на которой нет своей ладьи и ферзя (а ладья есть);
* outpost — свободное поле для коня на вертикалях c–f и на 4–6-й горизонтали от своего края, защищённое своей
  пешкой, которое пешка соперника уже не прогонит (у стороны есть конь);
* isolated_enemy — изолированная пешка соперника в центре (c–f) — объект атаки;
* backward_enemy — отсталая пешка соперника на полуоткрытой для стороны вертикали: соседние пешки ушли вперёд, а
  поле перед ней бьёт пешка стороны;
* bad_bishop — свой слон, а на полях его цвета стоит больше половины своих пешек (не меньше трёх) и хотя бы две
  из них заблокированы;
* doubled_own — свои сдвоенные пешки.

Признаки — для стороны color; порядок — от важного (безопасность короля, проходные) к частному.

Модуль ничего не хранит и не читает, кроме доски. Признаки превращает в предложения наставника
src/services/coach.py: совет по позиции, первая ступень подсказки и объяснение лучшего хода (``move_idea``); текст
собирает клиент из каталога coach.* по коду и параметрам (поле, вертикаль).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import chess

# Коды признаков в порядке важности; в этом же порядке их возвращает ``positional_features``.
POSITIONAL_PRIORITY = (
    "king_center", "king_holes", "passed_enemy", "passed_own", "king_active", "open_file", "outpost",
    "isolated_enemy", "backward_enemy", "bad_bishop", "doubled_own",
)
CENTRAL_FILES = (2, 3, 4, 5)  # c–f
# Эндшпиль: у каждой стороны лёгких и тяжёлых фигур не больше чем на ладью с лёгкой фигурой.
ENDGAME_MATERIAL = 8
PIECE_POINTS = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}  # очки фигур без пешек и короля


@dataclass(frozen=True)
class Feature:
    """Признак позиции: код, параметры для текста (поле или вертикаль) и поля, которые клиент подсвечивает."""

    code: str
    params: dict[str, str] = field(default_factory=dict)
    squares: tuple[chess.Square, ...] = ()


def _material(board: chess.Board, color: chess.Color) -> int:
    return sum(len(board.pieces(pt, color)) * points for pt, points in PIECE_POINTS.items())


def is_endgame(board: chess.Board) -> bool:
    """Эндшпиль по правилу модуля: ферзей нет ни у кого, и у каждой стороны фигур не больше чем на ENDGAME_MATERIAL."""
    return not board.pieces(chess.QUEEN, chess.WHITE) and not board.pieces(chess.QUEEN, chess.BLACK) and all(
        _material(board, color) <= ENDGAME_MATERIAL for color in chess.COLORS)


def _forward(color: chess.Color) -> int:
    return 1 if color == chess.WHITE else -1


def _relative_rank(square: chess.Square, color: chess.Color) -> int:
    """Горизонталь с точки зрения стороны: 0 — своя первая."""
    rank = chess.square_rank(square)
    return rank if color == chess.WHITE else 7 - rank


def is_passed(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    """Проходная ли пешка стороны color на поле: впереди на её и соседних вертикалях нет пешек соперника."""
    file, rank = chess.square_file(square), chess.square_rank(square)
    for enemy in board.pieces(chess.PAWN, not color):
        ef, er = chess.square_file(enemy), chess.square_rank(enemy)
        if abs(ef - file) <= 1 and (er - rank) * _forward(color) > 0:
            return False
    return True


def is_isolated(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    """Изолированная ли пешка: на соседних вертикалях нет своих пешек."""
    file = chess.square_file(square)
    return not any(abs(chess.square_file(p) - file) == 1 for p in board.pieces(chess.PAWN, color))


def pawn_can_attack(board: chess.Board, square: chess.Square, by: chess.Color) -> bool:
    """
    Может ли пешка стороны by когда-нибудь ударить поле: пешка на соседней вертикали ещё позади поля. Свободен ли
    её путь, не проверяется — оценка осторожная: поле считается недосягаемым, только когда такой пешки нет вовсе.
    """
    file, rank = chess.square_file(square), chess.square_rank(square)
    for pawn in board.pieces(chess.PAWN, by):
        pf, pr = chess.square_file(pawn), chess.square_rank(pawn)
        if abs(pf - file) == 1 and (rank - pr) * _forward(by) > 0:
            return True
    return False


def is_outpost(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    """
    Форпост для коня: поле на 4–6-й горизонтали от своего края, защищённое своей пешкой, на которое пешки соперника
    уже не смогут напасть. Поле, занятое своей фигурой (не конём), форпостом не считается.
    """
    if not 3 <= _relative_rank(square, color) <= 5:
        return False
    occupant = board.piece_at(square)
    if occupant is not None and occupant.color == color and occupant.piece_type != chess.KNIGHT:
        return False
    protected = any(board.piece_at(s) == chess.Piece(chess.PAWN, color)
                    for s in board.attackers(color, square))
    return protected and not pawn_can_attack(board, square, not color)


def is_open_file(board: chess.Board, file: int) -> bool:
    """Открытая вертикаль: на ней нет пешек ни одной из сторон."""
    return not any(chess.square_file(p) == file for p in board.pieces(chess.PAWN, chess.WHITE)) and not any(
        chess.square_file(p) == file for p in board.pieces(chess.PAWN, chess.BLACK))


def _central_first(squares: list[chess.Square]) -> list[chess.Square]:
    """Поля от центральных вертикалей к крайним: из нескольких кандидатов наставник называет самый центральный."""
    return sorted(squares, key=lambda s: (abs(chess.square_file(s) - 3.5), s))


def _king_center(board: chess.Board, color: chess.Color) -> Feature | None:
    """
    Король в центре. Молчим до 8-го хода (дебют ещё идёт), в эндшпиле и когда у соперника нет ни ферзя, ни фигур
    на 10 очков: атаковать короля ему нечем.
    """
    king = board.king(color)
    if king is None or is_endgame(board) or board.fullmove_number < 8:
        return None
    if not board.pieces(chess.QUEEN, not color) and _material(board, not color) < 10:
        return None
    if _relative_rank(king, color) == 0 and chess.square_file(king) in (3, 4):
        return Feature("king_center", {}, (king,))
    return None


def _passed(board: chess.Board, color: chess.Color, own: bool) -> Feature | None:
    """
    Проходная: своя (own) или соперника. Называется самая продвинутая (при равенстве — ближе к центру), и только
    если она дошла до четвёртой горизонтали от своего края: дальняя от превращения проходная — ещё не тема.
    """
    side = color if own else not color
    pawns = [p for p in board.pieces(chess.PAWN, side) if is_passed(board, p, side)]
    if not own:
        # Заблокированная фигурой проходная пока не опасна.
        pawns = [p for p in pawns if board.piece_at(p + 8 * _forward(side)) is None]
    if not pawns:
        return None
    lead = max(pawns, key=lambda p: (_relative_rank(p, side), -abs(chess.square_file(p) - 3.5)))
    if _relative_rank(lead, side) < 3:
        return None
    return Feature("passed_own" if own else "passed_enemy", {"square": chess.square_name(lead)}, (lead,))


def _king_active(board: chess.Board, color: chess.Color) -> Feature | None:
    king = board.king(color)
    if king is None or not is_endgame(board) or _relative_rank(king, color) > 1:
        return None
    return Feature("king_active", {}, (king,))


def _open_file(board: chess.Board, color: chess.Color) -> Feature | None:
    """
    Открытая вертикаль, не занятая своей ладьёй или ферзём; из нескольких — ближайшая к центру (d, e, c, f, b, g,
    a, h). Подсвечивается первая ладья стороны — та, которую можно туда поставить.
    """
    rooks = list(board.pieces(chess.ROOK, color))
    if not rooks:
        return None
    heavy_files = {chess.square_file(s) for s in rooks + list(board.pieces(chess.QUEEN, color))}
    files = [f for f in (3, 4, 2, 5, 1, 6, 0, 7) if is_open_file(board, f) and f not in heavy_files]
    if not files:
        return None
    file = files[0]
    return Feature("open_file", {"file": chess.FILE_NAMES[file]}, tuple(rooks[:1]))


def _outpost(board: chess.Board, color: chess.Color) -> Feature | None:
    """Свободный форпост на вертикалях c–f, если у стороны есть конь, который можно туда привести."""
    if not board.pieces(chess.KNIGHT, color):
        return None
    candidates = [s for s in chess.SQUARES if chess.square_file(s) in CENTRAL_FILES and is_outpost(board, s, color)]
    candidates = [s for s in candidates if board.piece_at(s) is None]
    if not candidates:
        return None
    square = _central_first(candidates)[0]
    return Feature("outpost", {"square": chess.square_name(square)}, (square,))


def _isolated_enemy(board: chess.Board, color: chess.Color) -> Feature | None:
    pawns = [p for p in board.pieces(chess.PAWN, not color)
             if chess.square_file(p) in CENTRAL_FILES and is_isolated(board, p, not color)]
    if not pawns:
        return None
    square = _central_first(pawns)[0]
    return Feature("isolated_enemy", {"square": chess.square_name(square)}, (square,))


def _shade(square: chess.Square) -> int:
    """Цвет поля: 0 — тёмное (как a1), 1 — светлое."""
    return (chess.square_file(square) + chess.square_rank(square)) % 2


def _king_holes(board: chess.Board, color: chess.Color) -> Feature | None:
    """
    Слабые поля у короля на фланге (не в эндшпиле, король на первой горизонтали). В параметре — ближайшая к королю
    «дыра», в подсветке — все.
    """
    king = board.king(color)
    if king is None or is_endgame(board) or _relative_rank(king, color) != 0:
        return None
    king_file = chess.square_file(king)
    if king_file in (3, 4):
        return None  # король в центре — об этом king_center
    holes = []
    # Третья горизонталь перед королём: поле прямо перед ним король защищает сам, а дыры после g3/h3 — f3, h3, g3.
    for file in range(max(0, king_file - 1), min(7, king_file + 1) + 1):
        square = chess.square(file, chess.square_rank(king) + 2 * _forward(color))
        if board.piece_at(square) == chess.Piece(chess.PAWN, color) or pawn_can_attack(board, square, color):
            continue
        shade = _shade(square)
        enemy_bishop = any(_shade(b) == shade for b in board.pieces(chess.BISHOP, not color))
        own_bishop = any(_shade(b) == shade for b in board.pieces(chess.BISHOP, color))
        if enemy_bishop and not own_bishop:
            holes.append(square)
    if not holes:
        return None
    nearest = min(holes, key=lambda s: (chess.square_distance(s, king), s))
    return Feature("king_holes", {"square": chess.square_name(nearest)}, tuple(holes))


def is_backward(board: chess.Board, square: chess.Square, color: chess.Color) -> bool:
    """
    Отсталая пешка стороны color: соседние пешки ушли вперёд и не защитят её, а поле перед ней бьёт пешка
    соперника — продвинуться нельзя.
    """
    file, rank = chess.square_file(square), _relative_rank(square, color)
    neighbours = [p for p in board.pieces(chess.PAWN, color) if abs(chess.square_file(p) - file) == 1]
    if not neighbours or any(_relative_rank(p, color) <= rank for p in neighbours):
        return False
    stop = square + 8 * _forward(color)
    if not 0 <= stop < 64:
        return False
    return any(board.piece_at(s) == chess.Piece(chess.PAWN, not color) for s in board.attackers(not color, stop))


def _backward_enemy(board: chess.Board, color: chess.Color) -> Feature | None:
    # Объект атаки, только если вертикаль полуоткрыта для нас: своя пешка не мешает давить на неё.
    own_files = {chess.square_file(p) for p in board.pieces(chess.PAWN, color)}
    pawns = [p for p in board.pieces(chess.PAWN, not color)
             if chess.square_file(p) not in own_files and is_backward(board, p, not color)]
    if not pawns:
        return None
    square = _central_first(pawns)[0]
    return Feature("backward_enemy", {"square": chess.square_name(square)}, (square,))


def _bad_bishop(board: chess.Board, color: chess.Color) -> Feature | None:
    """
    «Плохой» слон: на полях его цвета не меньше трёх своих пешек и больше половины всех своих пешек, причём хотя бы
    две из них упёрлись в фигуру или пешку. Подсвечиваются слон и заблокированные пешки.
    """
    pawns = list(board.pieces(chess.PAWN, color))
    for bishop in board.pieces(chess.BISHOP, color):
        shade = (chess.square_file(bishop) + chess.square_rank(bishop)) % 2
        same = [p for p in pawns if (chess.square_file(p) + chess.square_rank(p)) % 2 == shade]
        blocked = [p for p in same if board.piece_at(p + 8 * _forward(color)) is not None]
        if len(same) >= 3 and len(same) * 2 > len(pawns) and len(blocked) >= 2:
            return Feature("bad_bishop", {"square": chess.square_name(bishop)}, (bishop, *blocked))
    return None


def _doubled_own(board: chess.Board, color: chess.Color) -> Feature | None:
    by_file: dict[int, list[chess.Square]] = {}
    for pawn in board.pieces(chess.PAWN, color):
        by_file.setdefault(chess.square_file(pawn), []).append(pawn)
    doubled = [squares for squares in by_file.values() if len(squares) >= 2]
    if not doubled:
        return None
    squares = min(doubled, key=lambda group: abs(chess.square_file(group[0]) - 3.5))
    return Feature("doubled_own", {"file": chess.FILE_NAMES[chess.square_file(squares[0])]}, tuple(squares))


def positional_features(board: chess.Board, color: chess.Color) -> list[Feature]:
    """Признаки позиции для стороны color, в порядке POSITIONAL_PRIORITY."""
    found = [
        _king_center(board, color), _king_holes(board, color), _passed(board, color, own=False),
        _passed(board, color, own=True), _king_active(board, color), _open_file(board, color),
        _outpost(board, color), _isolated_enemy(board, color), _backward_enemy(board, color),
        _bad_bishop(board, color), _doubled_own(board, color),
    ]
    return [f for f in found if f is not None]


def move_idea(board: chess.Board, move: chess.Move) -> Feature | None:
    """
    Позиционная идея хода (для лучшего хода без тактики): рокировка, ладья на открытую вертикаль, конь на опорный
    пункт, король к центру в эндшпиле, продвижение проходной. Проверяются в этом порядке, возвращается первая.
    Коды castle и passed_push есть только здесь — в POSITIONAL_PRIORITY их нет.
    """
    piece = board.piece_at(move.from_square)
    if piece is None:
        return None
    color = piece.color
    if board.is_castling(move):
        return Feature("castle")
    to_file = chess.square_file(move.to_square)
    if piece.piece_type == chess.ROOK and to_file != chess.square_file(move.from_square) and is_open_file(board, to_file):
        return Feature("open_file", {"file": chess.FILE_NAMES[to_file]}, (move.to_square,))
    if piece.piece_type == chess.KNIGHT and is_outpost(board, move.to_square, color):
        return Feature("outpost", {"square": chess.square_name(move.to_square)}, (move.to_square,))
    if piece.piece_type == chess.KING and is_endgame(board):
        def center_distance(square: chess.Square) -> float:
            return abs(chess.square_file(square) - 3.5) + abs(chess.square_rank(square) - 3.5)
        if center_distance(move.to_square) < center_distance(move.from_square):
            return Feature("king_active", {}, (move.to_square,))
    if piece.piece_type == chess.PAWN and is_passed(board, move.from_square, color):
        return Feature("passed_push", {}, (move.to_square,))
    return None
