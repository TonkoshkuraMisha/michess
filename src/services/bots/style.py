# --- FILE: src/services/bots/style.py ---
"""
Модель стиля бота: правила, которые дают кандидатам из MultiPV бонус в сантипешках.

Оценку позиции даёт только Stockfish (или статический анализатор без движка). Стиль её не меняет:
он лишь переставляет кандидатов внутри окна blunder_guard_cp от лучшего хода, начисляя бонусы за
признаки хода, посчитанные python-chess (шах, взятие, рокировка, развитие, центр, пешечная структура...).

Стиль — это список правил:

* Rule(условие, бонус, комментарий, режим) — если условие выполнено, бонус прибавляется;
  комментарий либо перезаписывает текущий (SET), либо ставится, только если его ещё нет (FILL);
* Group(условие, *правила) — вложенные правила проверяются, только если выполнено общее условие;
* FirstOf(*правила) — срабатывает первое подходящее правило (аналог if/elif).

Так выражены и семь исторических ботов (пресеты в их модулях), и пользовательские персоналии
(src/services/bots/personality.py) — один интерпретатор на всех.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import Enum
from functools import cached_property

import chess

CENTER_SQUARES = frozenset({chess.D4, chess.E4, chess.D5, chess.E5})
EXTENDED_CENTER = frozenset({
    chess.C4, chess.D4, chess.E4, chess.F4,
    chess.C5, chess.D5, chess.E5, chess.F5,
})
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
        return self.board.gives_check(self.move)

    @cached_property
    def is_capture(self) -> bool:
        return self.board.is_capture(self.move)

    @cached_property
    def is_castling(self) -> bool:
        return self.board.is_castling(self.move)

    @cached_property
    def captured_piece_type(self) -> int | None:
        if self.board.is_en_passant(self.move):
            return chess.PAWN
        captured = self.board.piece_at(self.move.to_square)
        return captured.piece_type if captured and captured.color != self.us else None

    @cached_property
    def board_after(self) -> chess.Board:
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
    test: Callable[[MoveContext], bool]

    def __call__(self, ctx: MoveContext) -> bool:
        return self.test(ctx)

    def __and__(self, other: Cond) -> Cond:
        return Cond(lambda c: self.test(c) and other.test(c))

    def __or__(self, other: Cond) -> Cond:
        return Cond(lambda c: self.test(c) or other.test(c))

    def __invert__(self) -> Cond:
        return Cond(lambda c: not self.test(c))


ALWAYS = Cond(lambda c: True)
CHECK = Cond(lambda c: c.gives_check)
CAPTURE = Cond(lambda c: c.is_capture)
CASTLING = Cond(lambda c: c.is_castling)
FROM_BACK_RANK = Cond(
    lambda c: chess.square_rank(c.move.from_square) == (0 if c.us == chess.WHITE else 7)
)


def piece(*types: int) -> Cond:
    return Cond(lambda c: c.piece is not None and c.piece.piece_type in types)


def by_move(n: int) -> Cond:
    """Не позже n-го хода партии (fullmove_number)."""
    return Cond(lambda c: c.board.fullmove_number <= n)


def to(squares: Iterable[int]) -> Cond:
    target = frozenset(squares)
    return Cond(lambda c: c.move.to_square in target)


def to_file(*files: int) -> Cond:
    return Cond(lambda c: chess.square_file(c.move.to_square) in files)


def side(color: chess.Color) -> Cond:
    return Cond(lambda c: c.us == color)


def piece_on(square: int, expected: chess.Piece) -> Cond:
    return Cond(lambda c: c.board.piece_at(square) == expected)


# --- Правила -----------------------------------------------------------------------------------

class Note(Enum):
    SET = "set"  # перезаписать комментарий
    FILL = "fill"  # поставить, только если комментария ещё нет


Bonus = float | Callable[[MoveContext], float]


@dataclass(frozen=True)
class Rule:
    when: Cond
    bonus: Bonus
    note: str | None = None
    mode: Note = Note.SET

    def value(self, ctx: MoveContext) -> float:
        return self.bonus(ctx) if callable(self.bonus) else self.bonus


@dataclass(frozen=True)
class Group:
    when: Cond
    items: tuple[StyleItem, ...]

    def __init__(self, when: Cond, *items: StyleItem):
        object.__setattr__(self, "when", when)
        object.__setattr__(self, "items", items)


@dataclass(frozen=True)
class FirstOf:
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
        ctx = MoveContext(board_before, move)
        if ctx.piece is None:
            return 0.0, None
        acc = _Accumulator(self.note_by_weight)
        self._run(self.items, ctx, acc)
        return acc.bonus, acc.note

    def _run(self, items: Iterable[StyleItem], ctx: MoveContext, acc: _Accumulator) -> None:
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
    """Продвинутость, фаланги и защищённость пешек минус сдвоенные пешки."""
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
    return pawn_structure_score(ctx.board_after, ctx.us) - pawn_structure_score(ctx.board, ctx.us)


def mobility_count(board: chess.Board, color: chess.Color) -> int:
    """Число ходов стороны color в позиции (псевдолегальных — быстро и достаточно для сравнения)."""
    if board.turn == color:
        return board.pseudo_legal_moves.count()
    probe = board.copy(stack=False)
    probe.turn = color
    probe.ep_square = None
    return probe.pseudo_legal_moves.count()
