"""
Пешечные структуры (таск 27.5): определение по расположению пешек — для меток библиотеки партий, поиска «партии с
этой структурой» и будущих модулей Большого курса (С3–С4, `docs/research/supercourse.md`).

Правила — с точки зрения белых; для структур, которые бывают у любой стороны (изолированная, висячие, каменная стена,
карлсбадская и др.), проверяется и зеркальная позиция. Порядок проверки важен: более частные структуры раньше
общих (ёж — частный случай Мароци). Структура партии — самая долгая из встреченных между 12-м и 80-м полуходом
(не меньше 8 полуходов).
"""

from collections import Counter
from collections.abc import Callable, Iterable

import chess

STRUCTURES = ("hedgehog", "maroczy", "wedge", "kid_chain", "modern_benoni", "stonewall", "saw", "french_chain",
              "french_exchange", "carlsbad", "hanging_pawns", "isolated_pawn", "spanish", "symmetry")
FIRST_PLY, LAST_PLY, MIN_PLIES = 12, 80, 8


class Pawns:
    def __init__(self, board: chess.Board, color: chess.Color):
        self.ours = {chess.square_name(s) for s in board.pieces(chess.PAWN, color)}
        self.theirs = {chess.square_name(s) for s in board.pieces(chess.PAWN, not color)}

    def has(self, *squares: str) -> bool:
        return all(s in self.ours for s in squares)

    def they(self, *squares: str) -> bool:
        return all(s in self.theirs for s in squares)

    def none_on(self, file: str) -> bool:
        return not any(s[0] == file for s in self.ours)

    def they_none_on(self, file: str) -> bool:
        return not any(s[0] == file for s in self.theirs)


def _hedgehog(p: Pawns) -> bool:
    return (p.has("c4", "e4") and p.none_on("d") and p.they("b6", "d6", "e6") and p.they_none_on("c")
            and (p.they("a6") or p.they("a7")))


def _maroczy(p: Pawns) -> bool:
    return p.has("c4", "e4") and p.none_on("d") and (p.they("d6") or p.they("d7")) and p.they_none_on("c")


def _kid_chain(p: Pawns) -> bool:
    return p.has("d5", "e4") and p.they("d6", "e5")


def _wedge(p: Pawns) -> bool:
    """Клин в центре: d5 + e4 против c5 + d6 + e5 (закрытый центр с запертыми флангами пешек)."""
    return p.has("d5", "e4") and p.they("c5", "d6", "e5")


def _modern_benoni(p: Pawns) -> bool:
    return p.has("d5") and p.they("c5", "d6") and p.they_none_on("e")


def _saw(p: Pawns) -> bool:
    """«Пила»: d4 против c6 (c7) + e6, у чёрных нет d-пешки, у белых — e-пешки."""
    return (p.has("d4") and p.none_on("e") and p.they("e6") and (p.they("c6") or p.they("c7"))
            and p.they_none_on("d"))


def _french_chain(p: Pawns) -> bool:
    return p.has("d4", "e5") and p.they("d5", "e6")


def _french_exchange(p: Pawns) -> bool:
    return p.has("d4") and p.they("d5") and p.none_on("e") and p.they_none_on("e")


def _carlsbad(p: Pawns) -> bool:
    return p.has("d4") and p.none_on("c") and p.they("c6", "d5") and p.they_none_on("e")


def _hanging(p: Pawns) -> bool:
    return p.has("c4", "d4") and p.none_on("b") and p.none_on("e")


def _isolated(p: Pawns) -> bool:
    """Изолированная d-пешка: нет своих c- и e-пешек, у соперника нет d-пешки (иначе это Бенони или висячие)."""
    return (any(p.has(f"d{rank}") for rank in (3, 4, 5)) and p.none_on("c") and p.none_on("e")
            and p.they_none_on("d"))


def _stonewall(p: Pawns) -> bool:
    return p.has("d4", "e3", "f4")


def _spanish(p: Pawns) -> bool:
    return p.has("e4") and p.none_on("d") and p.they("d6") and p.they_none_on("e")


def _symmetry(p: Pawns) -> bool:
    """Симметрия в центре: e4 против e5, d-пешки разменены."""
    return p.has("e4") and p.they("e5") and p.none_on("d") and p.they_none_on("d")


RULES: tuple[tuple[str, Callable[[Pawns], bool]], ...] = (
    ("hedgehog", _hedgehog), ("maroczy", _maroczy), ("wedge", _wedge), ("kid_chain", _kid_chain),
    ("modern_benoni", _modern_benoni), ("stonewall", _stonewall), ("saw", _saw), ("french_chain", _french_chain),
    ("french_exchange", _french_exchange), ("carlsbad", _carlsbad), ("hanging_pawns", _hanging),
    ("isolated_pawn", _isolated), ("spanish", _spanish), ("symmetry", _symmetry),
)


def detect(board: chess.Board) -> str | None:
    """Структура позиции: правило для белых, затем — для зеркальной позиции (та же структура у чёрных)."""
    sides = (Pawns(board, chess.WHITE), Pawns(board.mirror(), chess.WHITE))
    for code, rule in RULES:
        if any(rule(side) for side in sides):
            return code
    return None


def game_structure(moves: Iterable[chess.Move], start: chess.Board | None = None) -> str | None:
    """Самая долгая структура партии между FIRST_PLY и LAST_PLY (не меньше MIN_PLIES полуходов)."""
    board = (start or chess.Board()).copy()
    seen: Counter[str] = Counter()
    for ply, move in enumerate(moves, start=1):
        board.push(move)
        if ply > LAST_PLY:
            break
        if ply >= FIRST_PLY and (code := detect(board)) is not None:
            seen[code] += 1
    if not seen:
        return None
    code, count = seen.most_common(1)[0]
    return code if count >= MIN_PLIES else None
