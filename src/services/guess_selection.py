# --- FILE: src/services/guess_selection.py ---
"""
Отбор позиций для «Угадай ход мастера» (таск 14.3). Требование владельца: позиции объективно решаемые — игрок находит
ход расчётом и пониманием, а не угадывает, что пришло в голову мастеру. Правила (на выводе движка, MultiPV ≥ 2):

* ход мастера — лучший ход движка и опережает второй не меньше GAP_CP; или только он сохраняет результат: у остальных
  ходов «выигрыш → равенство» или «равенство → проигрыш»;
* ход не очевиден: не единственный легальный, не взятие в ответ на взятие на том же поле, не взятие висящей фигуры
  дороже пешки, которое видно без расчёта;
* позиция вне дебюта (с MIN_PLY-го полухода) и ещё не решена: лучший ход не хуже -DECIDED_CP, а второй — не лучше
  +DECIDED_CP (иначе выигрывает что угодно).

Серии: 2–6 ходов игрока подряд, каждый проходит отбор, ходы соперника между ними — ходы партии; если соперник ошибся
больше OPPONENT_ERROR_CP, серия на этом обрывается.
"""

from dataclasses import dataclass

import chess

GAP_CP = 150
WIN_CP = 150
EQUAL_CP = 50
DECIDED_CP = 700
MIN_PLY = 20
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


def qualifies(board: chess.Board, move: chess.Move, lines: list[Line]) -> Verdict | None:
    """Проходит ли ход мастера отбор. board — позиция до хода (со стеком ходов партии), lines — MultiPV движка."""
    if board.ply() < MIN_PLY or len(lines) < 2:
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
