# --- FILE: src/services/openings.py ---
"""
Определение дебюта (таск 16.1): одна таблица вместо двух копий жёстких префиксов (game_state.py, api/bots.py).
Данные — src/services/data/openings.tsv (собирает scripts/build_openings.py из открытого набора lichess, CC0).

Дебют определяется по позиции: идём по ходам партии и запоминаем последнюю позицию, которая есть в таблице, — так
узнаются и перестановки ходов. Названия — английские имена собственные из набора (как имена игроков), не переводятся.
"""

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import chess

DATA = Path(__file__).resolve().parent / "data" / "openings.tsv"
# Глубже таблица почти не бывает (самая длинная запись набора — около 36 полуходов).
MAX_PLIES = 40
UNKNOWN_ECO = "A00"


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str


@dataclass(frozen=True)
class OpeningLine:
    """Запись таблицы с ходами — для любимых дебютов соперников мастерской (таск 21.2)."""

    eco: str
    name: str
    epd: str
    moves: tuple[str, ...]


@lru_cache(maxsize=1)
def lines() -> dict[str, OpeningLine]:
    with DATA.open(encoding="utf-8") as handle:
        return {row["epd"]: OpeningLine(row["eco"], row["name"], row["epd"], tuple(row["uci"].split()))
                for row in csv.DictReader(handle, delimiter="\t")}


def search(query: str, limit: int = 20) -> list[OpeningLine]:
    """Дебюты по части названия или по коду ECO: сначала названия, начинающиеся с запроса, внутри — короткие линии."""
    text = query.strip().lower()
    if not text:
        return []
    found = [line for line in lines().values()
             if text in line.name.lower() or line.eco.lower().startswith(text)]
    return sorted(found, key=lambda line: (not line.name.lower().startswith(text), len(line.moves), line.eco,
                                           line.name))[:limit]


@lru_cache(maxsize=1)
def _table() -> dict[str, Opening]:
    with DATA.open(encoding="utf-8") as handle:
        return {row["epd"]: Opening(row["eco"], row["name"]) for row in csv.DictReader(handle, delimiter="\t")}


def classify_board_line(board: chess.Board, moves: list[chess.Move]) -> Opening | None:
    """Дебют по ходам из стартовой позиции board (обычно — начальной)."""
    table = _table()
    found = table.get(board.epd())
    board = board.copy(stack=False)
    for move in moves[:MAX_PLIES]:
        if move not in board.legal_moves:
            break
        board.push(move)
        found = table.get(board.epd(), found)
    return found


def classify(moves_uci: list[str]) -> Opening | None:
    """Дебют партии из начальной позиции по ходам в UCI; None — ходов из таблицы не было."""
    moves = []
    for uci in moves_uci[:MAX_PLIES]:
        try:
            moves.append(chess.Move.from_uci(uci))
        except ValueError:
            break
    return classify_board_line(chess.Board(), moves)


def eco_code(moves_uci: list[str]) -> str:
    """Код ECO для заголовка PGN и колонки games.eco; неизвестное начало — A00."""
    opening = classify(moves_uci)
    return opening.eco if opening else UNKNOWN_ECO
