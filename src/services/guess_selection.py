# --- FILE: src/services/guess_selection.py ---
"""
Отбор позиций для «Угадай ход мастера» (таск 14.3). Требование владельца: позиции объективно решаемые — игрок находит
ход расчётом и пониманием, а не угадывает, что пришло в голову мастеру. Правила (на выводе движка, MultiPV ≥ 2):

* ход мастера — лучший ход движка и опережает второй не меньше GAP_CP; или только он сохраняет результат: у остальных
  ходов «выигрыш → равенство» или «равенство → проигрыш»;
* ход не очевиден: не единственный легальный, не взятие в ответ на взятие на том же поле, не взятие висящей фигуры
  дороже пешки, которое видно без расчёта;
* позиция вне книжного дебюта — после последней позиции партии из таблицы дебютов 16.1 (src/services/openings.py) и
  не раньше OPENING_FLOOR_PLY-го полухода (побочные начала, которых нет в таблице, — всё равно развитие);
* не технический эндшпиль: при TECHNICAL_PIECES фигурах и меньше ответ знают эндшпильные таблицы — это техника,
  а не понимание (для неё — эндшпильный тренажёр 14.4);
* позиция ещё не решена: лучший ход не хуже -DECIDED_CP, а второй — не лучше +DECIDED_CP (иначе выигрывает что
  угодно).

Темы позиции — те же, что у задач (src/services/puzzle_import.themes_for_row): ход мастера и продолжение движка
как решение, предыдущий ход партии — как ход соперника.

Серии: 2–6 ходов игрока подряд, каждый проходит отбор, ходы соперника между ними — ходы партии; если соперник ошибся
больше OPPONENT_ERROR_CP, серия на этом обрывается.
"""

from dataclasses import dataclass

import chess

from src.services import openings

GAP_CP = 150
WIN_CP = 150
EQUAL_CP = 50
DECIDED_CP = 700
OPENING_FLOOR_PLY = 10
TECHNICAL_PIECES = 7
THEME_LINE_PLIES = 4  # ход мастера и ещё три полухода линии движка
MAX_MATE_IN = 5
OPPONENT_ERROR_CP = 100
SERIES_MIN, SERIES_MAX = 2, 6

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

# Строка движка: ход и оценка в сантипешках с точки зрения стороны, которая ходит (мат — ±100000).
Line = tuple[chess.Move, int]


@dataclass(frozen=True)
class Verdict:
    reason: str  # "gap" | "only_move"
    best_cp: int
    gap_cp: int


def is_obvious(board: chess.Board, move: chess.Move) -> bool:
    """Ход, который делается без расчёта: единственный, размен-отыгрыш или взятие висящей фигуры."""
    if board.legal_moves.count() <= 1:
        return True
    if board.is_capture(move) and board.move_stack:
        before = board.copy()
        previous = before.pop()
        if before.is_capture(previous) and previous.to_square == move.to_square:
            return True  # взятие в ответ на взятие на том же поле — восстановление материала
    # Фигура дороже пешки просто висит — взять её можно без расчёта.
    captured = board.piece_type_at(move.to_square)
    return captured is not None and VALUES[captured] >= 3 and not board.attackers(not board.turn, move.to_square)


def book_plies(moves: list[chess.Move]) -> int:
    """Сколько полуходов партия шла по таблице дебютов: номер последней позиции из таблицы (0 — ни одной)."""
    table = openings.lines()
    board = chess.Board()
    last = 0
    for ply, move in enumerate(moves[:openings.MAX_PLIES], 1):
        if move not in board.legal_moves:
            break
        board.push(move)
        if board.epd() in table:
            last = ply
    return last


def in_opening(board: chess.Board, book_ply: int) -> bool:
    """Ход из этой позиции ещё дебютный: ведёт в позицию таблицы или сделан до OPENING_FLOOR_PLY-го полухода."""
    return board.ply() < max(book_ply, OPENING_FLOOR_PLY)


def is_technical_endgame(board: chess.Board) -> bool:
    return len(board.piece_map()) <= TECHNICAL_PIECES


def qualifies(board: chess.Board, move: chess.Move, lines: list[Line], book_ply: int = 0) -> Verdict | None:
    """
    Проходит ли ход мастера отбор. board — позиция до хода (со стеком ходов партии или с верным номером хода в FEN),
    lines — MultiPV движка, book_ply — результат book_plies для партии.
    """
    if in_opening(board, book_ply) or is_technical_endgame(board) or len(lines) < 2:
        return None
    ordered = sorted(lines, key=lambda line: line[1], reverse=True)
    (best_move, best), (_, second) = ordered[0], ordered[1]
    if best_move != move or best < -DECIDED_CP or second > DECIDED_CP:
        return None
    if is_obvious(board, move):
        return None
    if best - second >= GAP_CP:
        return Verdict("gap", best, best - second)
    if (best >= WIN_CP and second <= EQUAL_CP) or (best >= -EQUAL_CP and second <= -WIN_CP):
        return Verdict("only_move", best, best - second)
    return None


def build_series(passing_plies: list[int], opponent_errors: set[int]) -> list[list[int]]:
    """
    Серии из полуходов одной стороны, прошедших отбор: подряд (через ход соперника), без ошибки соперника между ними,
    длиной SERIES_MIN–SERIES_MAX (длинные режутся на части).
    """
    series: list[list[int]] = []
    current: list[int] = []
    for ply in sorted(passing_plies):
        if current and (ply != current[-1] + 2 or (ply - 1) in opponent_errors):
            series.append(current)
            current = []
        current.append(ply)
    if current:
        series.append(current)
    result = []
    for run in series:
        for start in range(0, len(run), SERIES_MAX):
            chunk = run[start:start + SERIES_MAX]
            if len(chunk) >= SERIES_MIN:
                result.append(chunk)
    return result


def difficulty(board: chess.Board, move: chess.Move, verdict: Verdict) -> int:
    """Сложность как рейтинг задачи: тихий ход и «единственный ход» труднее, большой отрыв — легче."""
    value = 1500
    if not board.is_capture(move) and not board.gives_check(move):
        value += 200
    if verdict.reason == "only_move":
        value += 100
    if verdict.gap_cp >= 400:
        value -= 200
    return value


def _mate_length(board: chess.Board, line: list[chess.Move]) -> int | None:
    """Ходов стороны мастера до мата, если линия заканчивается её матом (не длиннее MAX_MATE_IN)."""
    current = board.copy(stack=False)
    for index, move in enumerate(line[:2 * MAX_MATE_IN - 1]):
        if move not in current.legal_moves:
            return None
        current.push(move)
        if current.is_checkmate():
            return index // 2 + 1 if index % 2 == 0 else None
    return None


def position_themes(board: chess.Board, move: chess.Move, pv: list[chess.Move]) -> list[str]:
    """
    Коды тем реестра 13.0 для позиции: как у задачи — предыдущий ход партии за «ход соперника», ход мастера и
    продолжение движка (до THEME_LINE_PLIES полуходов, а при форсированном мате — до мата) за решение; мат в n ходов
    помечается так же, как в базе задач (mateIn<n>). Без предыдущего хода — пусто.
    """
    from src.services.puzzle_import import themes_for_row

    if not board.move_stack:
        return []
    before = board.copy()
    previous = before.pop()
    line = [move, *pv[1:]] if pv and pv[0] == move else [move]
    mate_in = _mate_length(board, line)
    tags = f"mateIn{mate_in}" if mate_in else ""
    line = line[:2 * mate_in - 1] if mate_in else line[:THEME_LINE_PLIES]
    return themes_for_row({"FEN": before.fen(), "Moves": " ".join(m.uci() for m in [previous, *line]), "Themes": tags})
