# --- FILE: src/services/bots/base.py ---

import json
import logging
import os
import random
import shutil
from pathlib import Path

import chess
import chess.engine

from src.services.engine_pool import get_engine_pool

logger = logging.getLogger(__name__)

BOTS_DIR = Path(__file__).resolve().parent
BOOKS_DIR = BOTS_DIR / "books"
PROJECT_ROOT = BOTS_DIR.parent.parent.parent

CENTER_SQUARES = {chess.D4, chess.E4, chess.D5, chess.E5}
EXTENDED_CENTER = {
    chess.C4, chess.D4, chess.E4, chess.F4,
    chess.C5, chess.D5, chess.E5, chess.F5,
}

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}


def normalize_fen_key(board: chess.Board) -> str:
    """Нормализует FEN до первых 3 полей (позиция, очередь хода, права рокировки)."""
    parts = board.fen().split(" ")
    return f"{parts[0]} {parts[1]} {parts[2]} -"


def resolve_stockfish_path(custom_path: str | None = None) -> str | None:
    """Ищет бинарник Stockfish в локальной папке bin/ проекта, системном PATH или стандартных путях Linux."""
    if custom_path and os.path.exists(custom_path):
        return custom_path

    for binary_name in ("stockfish.exe", "stockfish"):
        candidate = PROJECT_ROOT / "bin" / binary_name
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    which_path = shutil.which("stockfish")
    if which_path:
        return which_path

    for linux_path in ("/usr/games/stockfish", "/usr/bin/stockfish", "/usr/local/bin/stockfish"):
        if os.path.exists(linux_path) and os.path.isfile(linux_path):
            return linux_path

    return None


def load_bot_opening_book(
        bot_id: str,
        fallback_book: dict[str, list[tuple[str, int, str]]] | None = None,
) -> dict[str, list[tuple[str, int, str]]]:
    """
    Загружает дебютную книгу бота из src/services/bots/books/{bot_id}.json
    и аккуратно объединяет её с фирменными дебютными линиями fallback_book.
    """
    book: dict[str, list[tuple[str, int, str]]] = {}
    if fallback_book:
        for k, v in fallback_book.items():
            book[k] = list(v)

    candidates = [
        BOOKS_DIR / f"{bot_id}.json",
        PROJECT_ROOT / f"{bot_id}_generated_book.json",
    ]

    for json_path in candidates:
        if json_path.exists():
            try:
                with open(json_path, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and data:
                    for fen_key, moves in data.items():
                        parsed_moves = [
                            (str(m[0]), int(m[1]), str(m[2]))
                            for m in moves
                            if len(m) >= 3 and str(m[0]) != "0000"
                        ]
                        if not parsed_moves:
                            continue

                        if fen_key in book:
                            existing_ucis = {m[0] for m in parsed_moves}
                            for fb_move in book[fen_key]:
                                if fb_move[0] not in existing_ucis:
                                    parsed_moves.append(fb_move)
                        book[fen_key] = parsed_moves
                    break
            except Exception as exc:
                logger.warning("Не удалось загрузить книгу %s: %s", json_path, exc)

    return book


def _simulate_human_thinking_time(
        board: chess.Board,
        is_book_move: bool,
        bot_time_left_ms: int = 180000,
        base_time_ms: int = 180000,
) -> float:
    """
    Вычисляет рекомендуемое человеческое время раздумий шахматиста (в секундах)
    без блокировки рабочих потоков сервера через time.sleep().
    """
    piece_count = len(board.piece_map())
    move_number = board.fullmove_number

    is_opening = move_number <= 10 and piece_count >= 28
    is_endgame = piece_count <= 12

    if is_opening:
        base_delay = random.uniform(0.4, 0.9) if is_book_move else random.uniform(1.2, 2.8)
    elif is_endgame:
        base_delay = random.uniform(0.4, 1.0) if piece_count <= 6 else random.uniform(1.2, 2.6)
    else:
        legal_moves_count = board.legal_moves.count()
        complexity_mult = 0.7 + (min(legal_moves_count, 45) / 45.0) * 0.8
        base_delay = random.uniform(1.2, 3.0) * complexity_mult

    control_scale_factor = max(0.3, min(1.5, base_time_ms / 300000.0))
    adjusted_delay = base_delay * control_scale_factor

    if bot_time_left_ms < 30000:
        time_ratio = max(0.15, bot_time_left_ms / 30000.0)
        adjusted_delay = max(0.25, adjusted_delay * time_ratio)

    max_allowed = max(0.25, (bot_time_left_ms - 2000) / 1000.0)
    return round(min(adjusted_delay, max_allowed), 3)


def static_board_eval_cp(board: chess.Board, perspective: chess.Color) -> float:
    """Базовая статическая оценка позиции в сантипешках (fallback при отсутствии Stockfish)."""
    if board.is_checkmate():
        return -100000.0 if board.turn == perspective else 100000.0
    if board.is_stalemate() or board.is_insufficient_material():
        return 0.0

    score = 0.0
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if not p:
            continue
        val = float(PIECE_VALUES[p.piece_type])
        if sq in CENTER_SQUARES:
            val += 25.0 if p.piece_type == chess.PAWN else 15.0
        elif sq in EXTENDED_CENTER:
            val += 15.0 if p.piece_type == chess.PAWN else 8.0

        if p.color == perspective:
            score += val
        else:
            score -= val
    return score


def analyse_with_stockfish(
        board: chess.Board,
        engine_path: str | None,
        skill_level: int = 7,
        uci_elo: int | None = 1850,
        depth: int = 6,
        time_limit: float = 0.25,
        multipv: int = 6,
) -> dict[chess.Move, float]:
    """Запрашивает оценку топ-ходов у движка Stockfish."""
    if not engine_path or not os.path.exists(engine_path):
        return {}

    scores: dict[chess.Move, float] = {}
    options: dict[str, int | bool] = {"Skill Level": skill_level}
    if uci_elo is not None:
        options["UCI_LimitStrength"] = True
        options["UCI_Elo"] = uci_elo

    try:
        # Пул сам приводит UCI_Elo / Skill Level к допустимому диапазону движка.
        with get_engine_pool(engine_path).acquire(options) as engine:
            infos = engine.analyse(
                board,
                chess.engine.Limit(depth=depth, time=time_limit),
                multipv=min(multipv, board.legal_moves.count()),
            )
            if isinstance(infos, dict):
                infos = [infos]
            for info in infos:
                pv = info.get("pv")
                if pv:
                    mv = pv[0]
                    cp = info["score"].pov(board.turn).score(mate_score=100000)
                    if cp is not None:
                        scores[mv] = float(cp)
    except Exception as exc:
        logger.warning("Ошибка запуска Stockfish (%s): %s", engine_path, exc)
        return {}

    return scores


class HistoricalBot:
    """
    Базовый класс исторической шахматной персоны.
    Наследники задают только параметры силы, дебютную книгу и функцию стилевого бонуса.
    """

    bot_id: str = "base"
    engine_source_name: str = "historical_style_engine"
    default_comment: str = "Классический позиционный ход."
    blunder_guard_cp: float = 130.0
    jitter_range: float = 8.0
    multipv: int = 6
    opening_book: dict[str, list[tuple[str, int, str]]] = {}

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int = 7,
            uci_elo: int = 1850,
            search_depth: int = 6,
    ):
        self._explicit_stockfish_path = stockfish_path
        self.stockfish_path = resolve_stockfish_path(stockfish_path)
        self.skill_level = skill_level
        self.uci_elo = uci_elo
        self.search_depth = search_depth

    def _get_active_engine_path(self) -> str | None:
        if self._explicit_stockfish_path is not None:
            return self._explicit_stockfish_path if os.path.exists(self._explicit_stockfish_path) else None
        if self.stockfish_path and os.path.exists(self.stockfish_path):
            return self.stockfish_path
        self.stockfish_path = resolve_stockfish_path()
        return self.stockfish_path

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        """Переопределяется в подклассах для придания уникального шахматного стиля."""
        return 0.0, None

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Поиск хода в дебютной книге чемпиона
        fen_key = normalize_fen_key(board)
        if fen_key in self.opening_book:
            candidates = self.opening_book[fen_key]
            valid_book_moves = []
            for item in candidates:
                uci_str, weight, comment = item[0], int(item[1]), item[2]
                if uci_str == "0000":
                    continue
                try:
                    move = chess.Move.from_uci(uci_str)
                except ValueError:
                    continue
                if move in board.legal_moves:
                    valid_book_moves.append((move, max(weight, 1), comment))

            if valid_book_moves:
                _simulate_human_thinking_time(board, is_book_move=True)
                moves, weights, comments = zip(*valid_book_moves, strict=True)
                idx = random.choices(range(len(moves)), weights=weights, k=1)[0]
                chosen_move = moves[idx]
                san = board.san(chosen_move)
                board.push(chosen_move)
                return {
                    "uci": chosen_move.uci(),
                    "san": san,
                    "fen_after": board.fen(),
                    "source": "opening_book",
                    "comment": comments[idx],
                }

        _simulate_human_thinking_time(board, is_book_move=False)

        # 2. Тактический расчёт Stockfish
        engine_path = self._get_active_engine_path() if self.stockfish_path is not None else None
        base_scores = analyse_with_stockfish(
            board=board,
            engine_path=engine_path,
            skill_level=self.skill_level,
            uci_elo=self.uci_elo,
            depth=self.search_depth,
            time_limit=0.25,
            multipv=self.multipv,
        )

        used_stockfish = bool(base_scores)
        # Fallback-расчёт при отсутствии бинарника Stockfish
        if not base_scores:
            us = board.turn
            for mv in board.legal_moves:
                b1 = board.copy()
                b1.push(mv)
                if b1.is_checkmate():
                    base_scores[mv] = 100000.0
                    continue
                worst_reply_score = 100000.0
                for reply in b1.legal_moves:
                    b2 = b1.copy()
                    b2.push(reply)
                    s = static_board_eval_cp(b2, us)
                    if s < worst_reply_score:
                        worst_reply_score = s
                base_scores[mv] = worst_reply_score if b1.legal_moves.count() > 0 else 0.0

        # 3. Коридор допустимой уступки + индивидуальный стилевой бонус чемпиона
        max_tactical_cp = max(base_scores.values())
        candidate_scores = {
                               mv: cp for mv, cp in base_scores.items()
                               if cp >= max_tactical_cp - self.blunder_guard_cp
                           } or base_scores

        best_move = None
        best_total_score = -float("inf")
        best_comment = None

        for mv, tactical_cp in candidate_scores.items():
            style_bonus, note = self.evaluate_style_bonus(board, mv)
            jitter = random.uniform(-self.jitter_range, self.jitter_range)
            total_score = tactical_cp + style_bonus + jitter

            if total_score > best_total_score:
                best_total_score = total_score
                best_move = mv
                best_comment = note

        if best_move is None:
            best_move = next(iter(board.legal_moves))

        san = board.san(best_move)
        board.push(best_move)

        engine_backend = "stockfish" if used_stockfish else "fallback_minimax"
        logger.info(
            "Bot %s move %s via %s [%s] (engine=%s)",
            self.bot_id,
            san,
            self.engine_source_name,
            engine_backend,
            engine_path,
        )
        return {
            "uci": best_move.uci(),
            "san": san,
            "fen_after": board.fen(),
            "source": self.engine_source_name,
            "engine_backend": engine_backend,
            "comment": best_comment or self.default_comment,
        }
