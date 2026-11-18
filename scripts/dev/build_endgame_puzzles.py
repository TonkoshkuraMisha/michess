"""
Задачи на эндшпильную технику из эндшпильных таблиц (таск 27.8) → data/puzzles/endgame_generated.csv.gz.

В открытой базе задач почти нет чистой техники (ключевые поля, оппозиция, обход, правило квадрата, «не тот» слон),
поэтому позиции генерируются: случайная расстановка типа окончания → таблицы (settings.TABLEBASE_URL)
→ задача берётся, только если верный ход ровно один (выигрыш или, в защите, единственная ничья), и он подходит под
тему. Перед позицией ставится законный ход соперника (отход его короля), как в формате базы lichess: FEN — до хода
соперника, первый ход в Moves — его. Рейтинг — по глубине результата (DTZ). Темы — тегами «michess:<код>»
(идентификатор данных, не бренд).
Детерминирован (--seed); нужна сеть; в CI не запускается. Загрузка в базу — scripts/import_puzzles.py (источник
«regence», тема — из тега).

Лусены и Филидора здесь нет намеренно: в этих ладейных позициях верных ходов почти всегда несколько (замер 16.11.2026:
из 70 позиций Лусены и 50 позиций Филидора — ни одной с единственным ходом), а задача засчитывает один. Эти приёмы
отрабатываются в эндшпильном тренажёре (frontend/src/content/endgames.json: lucena, philidor), где годится любой ход,
верный по таблицам.

Вежливость к серверу таблиц: пауза между запросами, при ответе 429 — минута ожидания (так просит lichess).

    python -m scripts.dev.build_endgame_puzzles [--per-theme 90] [--output путь]
"""

import argparse
import csv
import gzip
import json
import pathlib
import random
import time
import urllib.error
import urllib.parse
import urllib.request

import chess

from src.core.config import settings
from src.services.puzzle_import import validate_row
from src.services.themes import THEMES_BY_CODE

OUTPUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "endgame_generated.csv.gz"
FIELDS = ("PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes")


def probe(fen: str) -> dict:
    """Ответ сервера таблиц (settings.TABLEBASE_URL) по позиции; 429 — минута ожидания, иначе до пяти попыток."""
    url = settings.TABLEBASE_URL + "?" + urllib.parse.urlencode({"fen": fen})
    request = urllib.request.Request(url, headers={"User-Agent": "regence-endgame-puzzles"})
    for attempt in range(5):
        try:
            return json.load(urllib.request.urlopen(request, timeout=15))
        except urllib.error.HTTPError as exc:
            time.sleep(61 if exc.code == 429 else 2 + attempt * 3)
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError("tablebase unavailable")


def place(pieces: dict[chess.Square, chess.Piece], turn: chess.Color) -> chess.Board | None:
    """Доска из расстановки и очереди хода; невозможная позиция или шах ходящему — None."""
    board = chess.Board(None)
    for square, piece in pieces.items():
        board.set_piece_at(square, piece)
    board.turn = turn
    board.castling_rights = 0
    return board if board.is_valid() and not board.is_check() else None


K, P, B = chess.KING, chess.PAWN, chess.BISHOP
W, BL = chess.WHITE, chess.BLACK


def sq(file: int, rank: int) -> chess.Square | None:
    """Поле по вертикали и горизонтали (0–7); за краем доски — None."""
    return chess.square(file, rank) if 0 <= file <= 7 and 0 <= rank <= 7 else None


def gen_kpk(rng: random.Random) -> chess.Board | None:
    """Король и пешка против короля, ход белых: короли рядом с пешкой — оппозиция, ключевые поля, обход."""
    pawn = sq(rng.randint(1, 6), rng.randint(1, 4))
    pf, pr = chess.square_file(pawn), chess.square_rank(pawn)
    wk = sq(pf + rng.randint(-2, 2), pr + rng.randint(-1, 2))
    bk = sq(pf + rng.randint(-2, 2), pr + rng.randint(2, 4))
    if None in (wk, bk) or len({pawn, wk, bk}) < 3:
        return None
    return place({pawn: chess.Piece(P, W), wk: chess.Piece(K, W), bk: chess.Piece(K, BL)}, W)


def gen_square(rng: random.Random) -> chess.Board | None:
    """Правило квадрата, ход белых: чёрный король в 3–4 вертикалях от пешки, белый король далеко позади."""
    pawn = sq(rng.randint(0, 7), rng.randint(1, 4))
    pf, pr = chess.square_file(pawn), chess.square_rank(pawn)
    wk = sq(rng.randint(0, 7), rng.randint(0, 2))
    bk = sq(pf + rng.choice([-4, -3, 3, 4]), pr + rng.randint(0, 3))
    if None in (wk, bk) or len({pawn, wk, bk}) < 3:
        return None
    return place({pawn: chess.Piece(P, W), wk: chess.Piece(K, W), bk: chess.Piece(K, BL)}, W)


def gen_wrong_bishop(rng: random.Random) -> chess.Board | None:
    """Защита: король чёрных против слона и крайней пешки, ход чёрных."""
    pf = rng.choice([0, 7])
    pawn = sq(pf, rng.randint(3, 5))
    corner = sq(pf, 7)
    dark_corner = not bool(chess.BB_SQUARES[corner] & chess.BB_LIGHT_SQUARES)
    bishops = [s for s in chess.SQUARES if bool(chess.BB_SQUARES[s] & chess.BB_LIGHT_SQUARES) == dark_corner]
    bishop = rng.choice(bishops)
    wk = sq(rng.randint(2, 5), rng.randint(2, 5))
    bk = sq(pf + (1 if pf == 0 else -1) * rng.randint(1, 3), rng.randint(5, 7))
    if None in (pawn, wk, bk) or len({pawn, wk, bk, bishop}) < 4:
        return None
    return place({pawn: chess.Piece(P, W), wk: chess.Piece(K, W), bk: chess.Piece(K, BL), bishop: chess.Piece(B, W)}, BL)


def key_squares(pawn: chess.Square) -> set[chess.Square]:
    """Ключевые поля пешки: на две горизонтали впереди (с пятой горизонтали — на одну и две), три вертикали."""
    f, r = chess.square_file(pawn), chess.square_rank(pawn)
    ranks = [r + 2] if r <= 3 else [r + 1, r + 2]
    return {s for rank in ranks for file in (f - 1, f, f + 1) if (s := sq(file, rank)) is not None}


def classify(board: chess.Board, move: chess.Move, kind: str) -> str | None:
    """Тема задачи по виду окончания и единственному ходу."""
    after = board.copy(stack=False)
    after.push(move)
    piece = board.piece_type_at(move.from_square)
    if kind == "kpk":
        pawn = next(iter(board.pieces(P, W)))
        if piece != K:
            return None
        own, other = after.king(W), after.king(BL)
        df = abs(chess.square_file(own) - chess.square_file(other))
        dr = abs(chess.square_rank(own) - chess.square_rank(other))
        if (df, dr) in ((0, 2), (2, 0)):
            return "opposition"
        if own in key_squares(pawn):
            return "key_squares"
        before = abs(chess.square_file(board.king(W)) - chess.square_file(other))
        if df > before:
            return "outflanking"
        return None
    if kind == "square":
        return "square_rule" if piece == P else None
    if kind == "wrong_bishop":
        return "wrong_bishop" if piece == K else None
    return None


def retreat(board: chess.Board, rng: random.Random) -> tuple[chess.Board, chess.Move] | None:
    """Позиция до хода соперника: его король приходит на своё поле с соседнего (законно, без шаха до хода)."""
    side = not board.turn
    king = board.king(side)
    options = []
    for origin in chess.SquareSet(chess.BB_KING_ATTACKS[king]):
        if board.piece_at(origin) is not None:
            continue
        before = board.copy(stack=False)
        before.remove_piece_at(king)
        before.set_piece_at(origin, chess.Piece(K, side))
        before.turn = side
        move = chess.Move(origin, king)
        if before.is_valid() and not before.is_check() and move in before.legal_moves:
            options.append((before, move))
    return rng.choice(options) if options else None


MAX_SOLVER_MOVES = 5


def extend(board: chess.Board, move: chess.Move, reply: str, limit: int) -> tuple[list[str], int]:
    """
    Линия решения: первый единственный ход, затем лучший ответ соперника по таблицам и снова ход решающего — пока
    он единственный (иначе задача «угадывается»). Возвращает ходы (UCI) и число запросов к таблицам.
    """
    line = [move.uci()]
    probes = 0
    current = board.copy(stack=False)
    current.push(move)
    for _ in range(limit - 1):
        if current.is_game_over() or any(p.piece_type == chess.QUEEN for p in current.piece_map().values()):
            break
        answer = probe(current.fen())
        probes += 1
        time.sleep(0.25)
        if not answer.get("moves"):
            break
        best = chess.Move.from_uci(answer["moves"][0]["uci"])  # лучший ответ соперника — первый в списке
        current.push(best)
        if current.is_game_over():
            current.pop()
            break
        options = probe(current.fen())
        probes += 1
        time.sleep(0.25)
        good = [m for m in options.get("moves", []) if m["category"] == reply]
        if len(good) != 1:
            current.pop()
            break
        nxt = chess.Move.from_uci(good[0]["uci"])
        line += [best.uci(), nxt.uci()]
        current.push(nxt)
    return line, probes


GENERATORS = {"kpk": (gen_kpk, "win"), "square": (gen_square, "win"), "wrong_bishop": (gen_wrong_bishop, "draw")}
THEMES = {"opposition": "kpk", "key_squares": "kpk", "outflanking": "kpk", "square_rule": "square",
          "wrong_bishop": "wrong_bishop"}
TAGS = {"kpk": "endgame pawnEndgame", "square": "endgame pawnEndgame", "wrong_bishop": "endgame equality"}


def save(path: pathlib.Path, found: dict[str, list[dict]]) -> int:
    """Записывает найденные задачи всех тем в сжатый CSV (формат базы lichess); возвращает их число."""
    rows = [row for rows in found.values() for row in rows]
    with gzip.open(path, "wt", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def main() -> None:
    """Генерирует задачи до --per-theme на тему или до --max-probes запросов к таблицам; сохраняет по ходу."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-theme", type=int, default=90)
    parser.add_argument("--seed", type=int, default=8)
    parser.add_argument("--max-probes", type=int, default=6000)
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument("--themes", default="", help="только эти темы через запятую (по умолчанию — все)")
    args = parser.parse_args()
    rng = random.Random(args.seed)
    wanted = [t for t in args.themes.split(",") if t] or list(THEMES)
    found: dict[str, list[dict]] = {theme: [] for theme in wanted}
    seen: set[str] = set()
    # Начальные позиции принятых задач: отступ (retreat) из разных проверенных позиций может привести в одну и ту же —
    # такая задача отличалась бы лишь первым ходом соперника, для игрока это повтор.
    starts: set[str] = set()
    probes = 0
    while probes < args.max_probes and any(len(v) < args.per_theme for v in found.values()):
        kinds = sorted({THEMES[t] for t, v in found.items() if len(v) < args.per_theme})
        kind = rng.choice(kinds)
        make, goal = GENERATORS[kind]
        board = make(rng)
        if board is None or board.fen() in seen:
            continue
        seen.add(board.fen())
        data = probe(board.fen())
        probes += 1
        time.sleep(0.25)
        if data.get("category") != goal:
            continue
        reply = "loss" if goal == "win" else "draw"
        good = [m for m in data["moves"] if m["category"] == reply]
        if len(good) != 1 or (goal == "draw" and all(m["category"] == "draw" for m in data["moves"])):
            continue
        move = chess.Move.from_uci(good[0]["uci"])
        theme = classify(board, move, kind)
        if theme not in found or len(found[theme]) >= args.per_theme:
            continue
        before = retreat(board, rng)
        if before is None:
            continue
        start, first = before
        if start.fen() in starts:
            continue
        line, extra = extend(board, move, reply, MAX_SOLVER_MOVES)
        probes += extra
        depth = abs(good[0].get("dtz") or data.get("dtz") or 10)
        solver_moves = (len(line) + 1) // 2
        rating = max(800, min(2400, 850 + depth * 10 + 180 * (solver_moves - 1) + (250 if goal == "draw" else 0)))
        row = {
            "PuzzleId": f"tb{len(seen):05d}{kind[:2]}", "FEN": start.fen(), "Moves": " ".join([first.uci(), *line]),
            "Rating": str(rating), "RatingDeviation": "80", "Popularity": "90", "NbPlays": "0",
            "Themes": f"{TAGS[kind]} michess:{theme}",
        }
        if theme not in THEMES_BY_CODE or not validate_row(row):
            continue
        found[theme].append(row)
        starts.add(start.fen())
        total = sum(len(v) for v in found.values())
        if total % 10 == 0:  # прогон долгий (запрос к таблицам — около секунды): найденное не теряется при обрыве
            save(args.output, found)
            print(probes, {t: len(v) for t, v in found.items()}, flush=True)
    total = save(args.output, found)
    print(f"probes {probes}, puzzles {total} -> {args.output}")
    print({t: len(v) for t, v in found.items()})


if __name__ == "__main__":
    main()
