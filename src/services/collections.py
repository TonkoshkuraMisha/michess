# --- FILE: src/services/collections.py ---
"""
«Забавные подборки» архива (таск 16.3). Для каждой партии считаются показатели (game_metrics), по ним — места в
подборках (rank_collections). Подборки:

* shortest — самые короткие партии, закончившиеся матом (неявки и мгновенные сдачи — не «короткие партии»);
* checks — больше всего шахов;
* capture_streak — самая длинная серия взятий подряд;
* peaceful — самые мирные: меньше всего взятий, при равенстве — длиннее партия (без взятий — первыми);
* promotions — больше всего превращений;
* pawn_wars — больше всего проходных пешек на доске одновременно;
* stalemates — «триумфальные ничьи»: партия закончилась патом (самые длинные — первыми).

Модуль только считает. Таблицу подборок (collection_entries) заполняет scripts/build_collections.py по PGN партий
архива, а отдаёт её раздел «Просмотр» (src/api/watch.py).
"""

import io
import zlib
from dataclasses import dataclass

import chess
import chess.pgn

# Коды подборок (по ним клиент берёт названия из каталогов) и число партий в каждой.
COLLECTIONS = ("shortest", "checks", "capture_streak", "peaceful", "promotions", "pawn_wars", "stalemates")
PER_COLLECTION = 10
MIN_PEACEFUL_PLIES = 40   # короткая партия без взятий — не «мирная», а просто короткая (40 полуходов — 20 ходов)


@dataclass(frozen=True)
class Metrics:
    """
    Показатели одной партии для подборок: длина, шахи, взятия и самая длинная их серия, превращения, проходные пешки,
    мат или пат.
    """
    plies: int
    decisive: bool
    checks: int
    captures: int
    capture_streak: int
    promotions: int
    passed_pawns: int
    stalemate: bool
    checkmate: bool
    # Подпись ходов: в архиве есть дубли одной партии — в подборке каждая партия один раз.
    signature: int


def passed_pawns(board: chess.Board) -> int:
    """Число проходных пешек обеих сторон: впереди на своей и соседних вертикалях нет пешек соперника."""
    total = 0
    for color in (chess.WHITE, chess.BLACK):
        enemy = board.pieces(chess.PAWN, not color)
        for square in board.pieces(chess.PAWN, color):
            file, rank = chess.square_file(square), chess.square_rank(square)
            ahead = range(rank + 1, 8) if color == chess.WHITE else range(rank - 1, -1, -1)
            blocked = any(
                chess.square(f, r) in enemy for r in ahead for f in (file - 1, file, file + 1) if 0 <= f < 8
            )
            total += not blocked
    return total


def game_metrics(pgn: str) -> Metrics | None:
    """
    Показатели партии по её PGN. None — партия из своей позиции (есть заголовок FEN), без результата или без ходов: в
    подборки она не идёт. Шах считается после каждого хода, проходные пешки — после каждого хода чёрных (берётся
    наибольшее число за партию), мат и пат — по последней позиции.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or "FEN" in game.headers or game.headers.get("Result") not in ("1-0", "0-1", "1/2-1/2"):
        return None
    board = game.board()
    plies = checks = captures = streak = best_streak = promotions = most_passed = 0
    for move in game.mainline_moves():
        capture = board.is_capture(move)
        captures += capture
        streak = streak + 1 if capture else 0
        best_streak = max(best_streak, streak)
        promotions += move.promotion is not None
        board.push(move)
        plies += 1
        checks += board.is_check()
        if board.pawns and plies % 2 == 0:  # раз в ход: проходные меняются медленно, а счёт недешёвый
            most_passed = max(most_passed, passed_pawns(board))
    if plies == 0:
        return None
    return Metrics(plies, game.headers["Result"] != "1/2-1/2", checks, captures, best_streak, promotions,
                   most_passed, board.is_stalemate(), board.is_checkmate(),
                   zlib.crc32(" ".join(m.uci() for m in board.move_stack).encode()))


def rank_collections(metrics: dict[int, Metrics], size: int = PER_COLLECTION) -> dict[str, list[tuple[int, int]]]:
    """
    Места в подборках: {подборка: [(id партии, показатель), …]}; при равенстве — меньший id. metrics — показатели по
    id партии, size — сколько партий в подборке. Условия отбора — в описании модуля.
    """
    items = list(metrics.items())

    def top(candidates, key, value) -> list[tuple[int, int]]:
        """Первые size партий по ключу сортировки; одна и та же партия (в архиве есть дубли) берётся один раз."""
        chosen: list[tuple[int, int]] = []
        seen: set[int] = set()
        for gid, m in sorted(candidates, key=lambda item: (key(item[1]), item[0])):
            if m.signature in seen:
                continue
            seen.add(m.signature)
            chosen.append((gid, value(m)))
            if len(chosen) == size:
                break
        return chosen

    return {
        "shortest": top([i for i in items if i[1].checkmate], lambda m: m.plies, lambda m: m.plies),
        "checks": top(items, lambda m: -m.checks, lambda m: m.checks),
        "capture_streak": top(items, lambda m: -m.capture_streak, lambda m: m.capture_streak),
        "peaceful": top([i for i in items if i[1].plies >= MIN_PEACEFUL_PLIES],
                        lambda m: (m.captures, -m.plies), lambda m: m.captures),
        "promotions": top([i for i in items if i[1].promotions], lambda m: -m.promotions, lambda m: m.promotions),
        "pawn_wars": top(items, lambda m: -m.passed_pawns, lambda m: m.passed_pawns),
        "stalemates": top([i for i in items if i[1].stalemate], lambda m: -m.plies, lambda m: m.plies),
    }
