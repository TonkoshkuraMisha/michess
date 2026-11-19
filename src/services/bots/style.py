# --- FILE: src/services/bots/style.py ---
"""
Модель стиля бота: правила, которые дают кандидатам из MultiPV бонус в сантипешках.

Оценку позиции даёт только движок (или статический анализатор без него). Стиль её не меняет:
он лишь переставляет кандидатов внутри окна blunder_guard_cp от лучшего хода, начисляя бонусы за
признаки хода, посчитанные python-chess (шах, взятие, рокировка, развитие, центр, пешечная структура...).

Стиль — это список правил:

* Rule(условие, бонус, комментарий, режим) — если условие выполнено, бонус прибавляется;
  комментарий либо перезаписывает текущий (SET), либо ставится, только если его ещё нет (FILL);
* Group(условие, *правила) — вложенные правила проверяются, только если выполнено общее условие;
* FirstOf(*правила) — срабатывает первое подходящее правило (аналог if/elif).

Так выражены и семь исторических ботов (пресеты в их модулях), и пользовательские персоналии
(src/services/bots/personality.py) — один интерпретатор на всех.

Модуль не ходит ни в базу, ни в сеть: правила — чистые функции от позиции и хода. Применяют их base.HistoricalBot и
симуляция турниров (Style.evaluate).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import Enum
from functools import cached_property

import chess

# Четыре центральных поля: d4, e4, d5, e5.
CENTER_SQUARES = frozenset({chess.D4, chess.E4, chess.D5, chess.E5})
# Расширенный центр: вертикали c–f на 4-й и 5-й горизонталях (включает CENTER_SQUARES).
EXTENDED_CENTER = frozenset({
    chess.C4, chess.D4, chess.E4, chess.F4,
    chess.C5, chess.D5, chess.E5, chess.F5,
})
# Лёгкие фигуры — тем, кому нужно «развитие».
MINOR_PIECES = (chess.KNIGHT, chess.BISHOP)


class MoveContext:
    """Ход в позиции до него; дорогие признаки считаются лениво и один раз."""

    def __init__(self, board: chess.Board, move: chess.Move):
        self.board = board
        self.move = move
        self.us = board.turn
        self.piece = board.piece_at(move.from_square)

    @cached_property
    def gives_check(self) -> bool:
        """Ход даёт шах."""
        return self.board.gives_check(self.move)

    @cached_property
    def is_capture(self) -> bool:
        """Ход — взятие (в том числе на проходе)."""
        return self.board.is_capture(self.move)

    @cached_property
    def is_castling(self) -> bool:
        """Ход — рокировка."""
        return self.board.is_castling(self.move)

    @cached_property
    def captured_piece_type(self) -> int | None:
        """Тип взятой фигуры (при взятии на проходе — пешка); None — взятия нет."""
        if self.board.is_en_passant(self.move):
            return chess.PAWN
        captured = self.board.piece_at(self.move.to_square)
        return captured.piece_type if captured and captured.color != self.us else None

    @cached_property
    def board_after(self) -> chess.Board:
        """Позиция после хода (копия без истории ходов)."""
        after = self.board.copy(stack=False)
        after.push(self.move)
        return after

    @cached_property
    def destination_attacked(self) -> bool:
        """Поле назначения после хода бьётся соперником (фигура может быть взята)."""
        return self.board_after.is_attacked_by(not self.us, self.move.to_square)


# --- Условия -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Cond:
    """
    Условие правила стиля — проверка хода в его контексте. Условия сочетаются операторами: & — и, | — или, ~ — не.
    """
    test: Callable[[MoveContext], bool]

    def __call__(self, ctx: MoveContext) -> bool:
        return self.test(ctx)

    def __and__(self, other: Cond) -> Cond:
        return Cond(lambda c: self.test(c) and other.test(c))

    def __or__(self, other: Cond) -> Cond:
        return Cond(lambda c: self.test(c) or other.test(c))

    def __invert__(self) -> Cond:
        return Cond(lambda c: not self.test(c))


# Готовые условия: всегда, шах, взятие, рокировка, ход с первой горизонтали своей стороны.
ALWAYS = Cond(lambda c: True)
CHECK = Cond(lambda c: c.gives_check)
CAPTURE = Cond(lambda c: c.is_capture)
CASTLING = Cond(lambda c: c.is_castling)
FROM_BACK_RANK = Cond(
    lambda c: chess.square_rank(c.move.from_square) == (0 if c.us == chess.WHITE else 7)
)


def piece(*types: int) -> Cond:
    """Ходит фигура одного из типов types (chess.PAWN, chess.KNIGHT ...)."""
    return Cond(lambda c: c.piece is not None and c.piece.piece_type in types)


def by_move(n: int) -> Cond:
    """Не позже n-го хода партии (fullmove_number)."""
    return Cond(lambda c: c.board.fullmove_number <= n)


def to(squares: Iterable[int]) -> Cond:
    """Поле назначения хода входит в squares."""
    target = frozenset(squares)
    return Cond(lambda c: c.move.to_square in target)


def to_file(*files: int) -> Cond:
    """Вертикаль поля назначения — одна из files (0 — вертикаль a)."""
    return Cond(lambda c: chess.square_file(c.move.to_square) in files)


def side(color: chess.Color) -> Cond:
    """Ходит сторона color."""
    return Cond(lambda c: c.us == color)


def piece_on(square: int, expected: chess.Piece) -> Cond:
    """До хода на поле square стоит именно фигура expected (цвет и тип)."""
    return Cond(lambda c: c.board.piece_at(square) == expected)


# --- Правила -----------------------------------------------------------------------------------

class Note(Enum):
    """Как правило ставит реплику хода: SET — всегда, FILL — только если реплики ещё нет."""

    SET = "set"  # перезаписать комментарий
    FILL = "fill"  # поставить, только если комментария ещё нет


# Бонус правила: число сантипешек или функция от контекста хода (признак с вычисляемым весом).
Bonus = float | Callable[[MoveContext], float]


@dataclass(frozen=True)
class Rule:
    """Правило: если выполнено when — к ходу прибавляется bonus (сп) и ставится реплика note (ключ botComments) по mode."""

    when: Cond
    bonus: Bonus
    note: str | None = None
    mode: Note = Note.SET

    def value(self, ctx: MoveContext) -> float:
        """Бонус правила для хода: число или результат функции."""
        return self.bonus(ctx) if callable(self.bonus) else self.bonus


@dataclass(frozen=True)
class Group:
    """Вложенные правила items, которые проверяются, только если для хода выполнено общее условие when."""

    when: Cond
    items: tuple[StyleItem, ...]

    def __init__(self, when: Cond, *items: StyleItem):
        object.__setattr__(self, "when", when)
        object.__setattr__(self, "items", items)


@dataclass(frozen=True)
class FirstOf:
    """Из rules срабатывает только первое подходящее (как if/elif)."""

    rules: tuple[Rule, ...]

    def __init__(self, *rules: Rule):
        object.__setattr__(self, "rules", rules)


StyleItem = Rule | Group | FirstOf


class _Accumulator:
    """Сумма бонусов и итоговый комментарий хода."""

    def __init__(self, note_by_weight: bool):
        self.bonus = 0.0
        self.note: str | None = None
        self._note_by_weight = note_by_weight
        self._note_weight = 0.0

    def apply(self, rule: Rule, ctx: MoveContext) -> None:
        """
        Учитывает сработавшее правило: прибавляет его бонус и решает, чья реплика останется у хода (правила SET
        перезаписывают её, FILL — только заполняют пустую; у персоналий — реплика самого весомого признака).
        """
        value = rule.value(ctx)
        self.bonus += value
        if rule.note is None:
            return
        if self._note_by_weight:
            # Комментарий самого весомого положительного признака хода.
            if value > self._note_weight:
                self.note, self._note_weight = rule.note, value
        elif rule.mode is Note.SET or self.note is None:
            self.note = rule.note


class Style:
    """
    Набор правил стиля. note_by_weight=False — комментарии по порядку правил (SET/FILL), как в
    исторических ботах; True — комментарий правила с наибольшим бонусом (персоналии с ползунками).
    """

    def __init__(self, name: str, *items: StyleItem, note_by_weight: bool = False):
        self.name = name
        self.items = items
        self.note_by_weight = note_by_weight

    def evaluate(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        """Сумма бонусов (сп) и ключ реплики для хода в позиции до него; (0, None) — если на поле отправления пусто."""
        ctx = MoveContext(board_before, move)
        if ctx.piece is None:
            return 0.0, None
        acc = _Accumulator(self.note_by_weight)
        self._run(self.items, ctx, acc)
        return acc.bonus, acc.note

    def _run(self, items: Iterable[StyleItem], ctx: MoveContext, acc: _Accumulator) -> None:
        """Обходит правила по порядку: Rule применяется, Group раскрывается, FirstOf берёт первое подходящее."""
        for item in items:
            if isinstance(item, Rule):
                if item.when(ctx):
                    acc.apply(item, ctx)
            elif isinstance(item, Group):
                if item.when(ctx):
                    self._run(item.items, ctx, acc)
            else:
                for rule in item.rules:
                    if rule.when(ctx):
                        acc.apply(rule, ctx)
                        break


# --- Позиционные признаки, общие для пресетов и персоналий ---------------------------------------

def pawn_structure_score(board: chess.Board, us: chess.Color) -> float:
    """
    Оценка пешечной структуры стороны us (условные очки): +3 за каждую горизонталь продвижения, +15 за пешку в фаланге
    (соседка справа на той же горизонтали), +10 за пешку, защищённую пешкой, −20 за каждую сдвоенную.
    """
    our_pawns = board.pieces(chess.PAWN, us)
    start_rank = 1 if us == chess.WHITE else 6
    pawn_files = [chess.square_file(sq) for sq in our_pawns]

    score = 0.0
    for sq in our_pawns:
        f = chess.square_file(sq)
        r = chess.square_rank(sq)
        if r != start_rank:
            score += float(r if us == chess.WHITE else (7 - r)) * 3.0
        if f < 7 and chess.square(f + 1, r) in our_pawns:
            score += 15.0
        support_rank = (r - 1) if us == chess.WHITE else (r + 1)
        # Диапазон проверяется первым: для крайних горизонталей support_rank выходит за доску.
        if 0 <= support_rank <= 7 and (
                (f > 0 and chess.square(f - 1, support_rank) in our_pawns)
                or (f < 7 and chess.square(f + 1, support_rank) in our_pawns)
        ):
            score += 10.0

    doubled_pawns = len(pawn_files) - len(set(pawn_files))
    score -= float(doubled_pawns) * 20.0
    return score


def pawn_structure_delta(ctx: MoveContext) -> float:
    """Как ход меняет пешечную структуру своей стороны (pawn_structure_score после минус до)."""
    return pawn_structure_score(ctx.board_after, ctx.us) - pawn_structure_score(ctx.board, ctx.us)


def mobility_count(board: chess.Board, color: chess.Color) -> int:
    """Число ходов стороны color в позиции (псевдолегальных — быстро и достаточно для сравнения)."""
    if board.turn == color:
        return board.pseudo_legal_moves.count()
    probe = board.copy(stack=False)
    probe.turn = color
    probe.ep_square = None
    return probe.pseudo_legal_moves.count()


# --- Признаки характера в миттельшпиле (таск B.5): общие для мастерской и исторических ботов -----------------

# Стандартная шкала ценности фигур в пешках (для оценки жертв и «вкуса» персоналии к фигурам); короля в ней нет.
STANDARD_VALUES = {chess.PAWN: 1.0, chess.KNIGHT: 3.0, chess.BISHOP: 3.0, chess.ROOK: 5.0, chess.QUEEN: 9.0}


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
    """Фигура встаёт не дальше двух клеток от короля соперника."""
    king = c.board.king(not c.us)
    return king is not None and chess.square_distance(c.move.to_square, king) <= 2


# Жертва, фигура у короля соперника и тихий ход (ни шаха, ни взятия).
SACRIFICE = Cond(_sacrifice)
NEAR_ENEMY_KING = Cond(_near_enemy_king)
QUIET = ~CHECK & ~CAPTURE


def after_move(n: int) -> Cond:
    """После n-го хода партии — миттельшпиль и дальше (пара к by_move)."""
    return Cond(lambda c: c.board.fullmove_number > n)


def _active_moves(board: chess.Board, color: chess.Color) -> int:
    """Взятия и шахи, доступные стороне color, — её угрозы."""
    probe = board
    if board.turn != color:
        probe = board.copy(stack=False)
        probe.turn = color
        probe.ep_square = None
    return sum(1 for m in probe.pseudo_legal_moves if probe.is_capture(m) or probe.gives_check(m))


def prophylaxis(c: MoveContext) -> float:
    """
    Профилактика: сколько угроз (взятий и шахов) ход отнимает у соперника — главный вклад (6 сп за угрозу, до 6
    угроз), и насколько сокращает его подвижность — дополнительный (1 сп за поле, до 10).
    """
    them = not c.us
    threats_removed = _active_moves(c.board, them) - _active_moves(c.board_after, them)
    squares_removed = mobility_count(c.board, them) - mobility_count(c.board_after, them)
    return 6.0 * max(0, min(6, threats_removed)) + 1.0 * max(0, min(10, squares_removed))
