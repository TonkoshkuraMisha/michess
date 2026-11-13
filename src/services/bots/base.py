# --- FILE: src/services/bots/base.py ---

import json
import logging
import os
import random
import shutil
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine

from src.services.bots.style import CENTER_SQUARES, EXTENDED_CENTER, Style
from src.services.engine_pool import get_engine_pool

logger = logging.getLogger(__name__)

BOTS_DIR = Path(__file__).resolve().parent
BOOKS_DIR = BOTS_DIR / "books"
PROJECT_ROOT = BOTS_DIR.parent.parent.parent

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


# Ход дебютной книги: (UCI, вес, заметка). Заметка — ключ фирменной реплики бота (ручные линии в коде)
# или число партий архива с этим ходом (книги из src/services/bots/books/*.json).
BookEntry = tuple[str, int, str | int]


def bot_comment(key: str, **params: int | str) -> dict:
    """
    Реплика бота для клиента: ключ каталога botComments и параметры — текст на трёх языках
    собирает клиент (frontend/src/i18n/messages/*.ts). Сервер русских фраз не отдаёт.
    """
    return {"key": key, "params": params}


def load_bot_opening_book(
        bot_id: str,
        fallback_book: dict[str, list[BookEntry]] | None = None,
) -> dict[str, list[BookEntry]]:
    """
    Загружает дебютную книгу бота из src/services/bots/books/{bot_id}.json
    и аккуратно объединяет её с фирменными дебютными линиями fallback_book.
    """
    book: dict[str, list[BookEntry]] = {}
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
                        parsed_moves: list[BookEntry] = [
                            (str(m[0]), int(m[1]), int(m[2]))
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


def fallback_scores(board: chess.Board) -> dict[chess.Move, float]:
    """Статический анализатор без движка: каждый ход оценивается по худшему ответу соперника (2 полухода)."""
    us = board.turn
    scores: dict[chess.Move, float] = {}
    for mv in board.legal_moves:
        b1 = board.copy()
        b1.push(mv)
        if b1.is_checkmate():
            scores[mv] = 100000.0
            continue
        worst_reply_score = 100000.0
        for reply in b1.legal_moves:
            b2 = b1.copy()
            b2.push(reply)
            s = static_board_eval_cp(b2, us)
            if s < worst_reply_score:
                worst_reply_score = s
        scores[mv] = worst_reply_score if b1.legal_moves.count() > 0 else 0.0
    return scores


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
    # Анализ — на полной силе. UCI_LimitStrength/UCI_Elo/Skill Level в Stockfish ослабляют только выбор хода
    # в play(), а оценки analyse() не меняют (проверено калибровкой 13.11, таск 10.5): сила бота задаётся
    # опорным ходом strength_reference_move, а не опциями анализа. skill_level и uci_elo оставлены в
    # сигнатуре для совместимости вызовов.
    del skill_level, uci_elo

    try:
        with get_engine_pool(engine_path).acquire({}) as engine:
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


def strength_reference_move(
        board: chess.Board, engine_path: str | None, uci_elo: int | None, time_limit: float,
) -> chess.Move | None:
    """
    Ход, который сыграл бы Stockfish с ограничением силы UCI_Elo (таск 10.5) — эталон силы бота: его ослабление
    откалибровано самим движком. None — без движка или без ограничения силы.
    """
    if uci_elo is None or not engine_path or not os.path.exists(engine_path):
        return None
    try:
        # Пул сам приводит UCI_Elo к допустимому диапазону движка (у Stockfish — от 1320).
        with get_engine_pool(engine_path).acquire({"UCI_LimitStrength": True, "UCI_Elo": uci_elo}) as engine:
            return engine.play(board, chess.engine.Limit(time=time_limit)).move
    except Exception as exc:
        logger.warning("Stockfish reference move failed (%s): %s", engine_path, exc)
        return None


def score_move(board: chess.Board, engine_path: str, move: chess.Move, depth: int, time_limit: float) -> float | None:
    """Оценка одного хода на полной силе (для опорного хода, не попавшего в MultiPV)."""
    try:
        with get_engine_pool(engine_path).acquire({}) as engine:
            info = engine.analyse(board, chess.engine.Limit(depth=depth, time=time_limit), root_moves=[move])
            cp = info["score"].pov(board.turn).score(mate_score=100000)
            return float(cp) if cp is not None else None
    except Exception as exc:
        logger.warning("Stockfish move scoring failed (%s): %s", engine_path, exc)
        return None


@dataclass
class Candidates:
    """Кандидаты хода: оценки (сп за ходящую сторону), опорный ход силы, был ли движок и путь к нему."""

    scores: dict[chess.Move, float]
    reference: chess.Move | None
    used_engine: bool
    engine_path: str | None


# Окно выбора вокруг опорного хода силы: стиль может уступить опорному ходу до половины blunder_guard_cp, но
# превзойти его — не больше чем на STRENGTH_UPSIDE_CP. Симметричное окно (калибровка 13.11) давало агрессивным
# персоналиям с широким окном +300…+400 к заявленной силе: стиль «исправлял» слабый опорный ход.
STRENGTH_BAND_SHARE = 0.5
STRENGTH_UPSIDE_CP = 20.0


class HistoricalBot:
    """
    Бот со стилем: дебютная книга, затем кандидаты Stockfish (MultiPV) или статического анализатора,
    из которых стиль (src/services/bots/style.py) выбирает ход внутри окна blunder_guard_cp от лучшего.
    Исторические боты задают только параметры силы, книгу и пресет стиля; персоналии с ползунками —
    src/services/bots/personality.py.
    """

    bot_id: str = "base"
    engine_source_name: str = "historical_style_engine"
    default_comment: str = "common.positional"
    blunder_guard_cp: float = 130.0
    jitter_range: float = 8.0
    multipv: int = 6
    time_limit: float = 0.25
    opening_book: dict[str, list[BookEntry]] = {}
    style: Style = Style("neutral")
    default_skill_level: int = 7
    default_uci_elo: int = 1850
    default_search_depth: int = 6

    def __init__(
            self,
            stockfish_path: str | None = None,
            skill_level: int | None = None,
            uci_elo: int | None = None,
            search_depth: int | None = None,
    ):
        self._explicit_stockfish_path = stockfish_path
        self.stockfish_path = resolve_stockfish_path(stockfish_path)
        self.skill_level = self.default_skill_level if skill_level is None else skill_level
        self.uci_elo: int | None = self.default_uci_elo if uci_elo is None else uci_elo
        self.search_depth = self.default_search_depth if search_depth is None else search_depth

    def _get_active_engine_path(self) -> str | None:
        if self._explicit_stockfish_path is not None:
            return self._explicit_stockfish_path if os.path.exists(self._explicit_stockfish_path) else None
        if self.stockfish_path and os.path.exists(self.stockfish_path):
            return self.stockfish_path
        self.stockfish_path = resolve_stockfish_path()
        return self.stockfish_path

    def evaluate_style_bonus(self, board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
        return self.style.evaluate(board_before, move)

    def _book_note(self, note: str | int) -> dict:
        """Реплика к ходу книги: фирменная фраза по ключу или «ход из партий архива» с их числом."""
        if isinstance(note, int):
            return bot_comment(f"book.{self.bot_id}", games=note)
        return bot_comment(note)

    def _book_move(self, board: chess.Board) -> tuple[chess.Move, dict] | None:
        candidates = self.opening_book.get(normalize_fen_key(board))
        if not candidates:
            return None
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
        if not valid_book_moves:
            return None
        moves, weights, comments = zip(*valid_book_moves, strict=True)
        idx = random.choices(range(len(moves)), weights=weights, k=1)[0]
        return moves[idx], self._book_note(comments[idx])

    def _candidate_scores(self, board: chess.Board) -> Candidates:
        """Кандидаты MultiPV на полной силе и опорный ход силы (ход Stockfish с ограничением UCI_Elo)."""
        engine_path = self._get_active_engine_path() if self.stockfish_path is not None else None
        scores = analyse_with_stockfish(
            board=board,
            engine_path=engine_path,
            skill_level=self.skill_level,
            uci_elo=self.uci_elo,
            depth=self.search_depth,
            time_limit=self.time_limit,
            multipv=self.multipv,
        )
        if not scores:
            return Candidates(fallback_scores(board), None, False, engine_path)
        reference = strength_reference_move(board, engine_path, self.uci_elo, self.time_limit)
        if reference is not None and reference not in scores and engine_path:
            value = score_move(board, engine_path, reference, self.search_depth, self.time_limit)
            if value is None:
                reference = None
            else:
                scores[reference] = value
        return Candidates(scores, reference, True, engine_path)

    def _window(self, scores: dict[chess.Move, float], reference: chess.Move | None) -> dict[chess.Move, float]:
        """
        Ходы, среди которых выбирает стиль. С опорным ходом — не сильнее его больше чем на STRENGTH_UPSIDE_CP и не
        слабее больше чем на половину blunder_guard_cp: бот не сильнее заявленной силы. Без опорного хода (нет движка)
        — окно от лучшего хода.
        """
        if reference is not None and reference in scores:
            ref = scores[reference]
            band = self.blunder_guard_cp * STRENGTH_BAND_SHARE
            window = {mv: cp for mv, cp in scores.items() if ref - band <= cp <= ref + STRENGTH_UPSIDE_CP}
            window[reference] = ref
            return window
        best = max(scores.values())
        return {mv: cp for mv, cp in scores.items() if cp >= best - self.blunder_guard_cp} or scores

    def _select_move(
            self, board: chess.Board, scores: dict[chess.Move, float], reference: chess.Move | None = None,
    ) -> tuple[chess.Move, str | None]:
        """Лучший по сумме «оценка + стиль + разброс» среди ходов окна силы (см. _window)."""
        candidate_scores = self._window(scores, reference)

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
        return best_move, best_comment

    def _comment_for(self, board: chess.Board, move: chess.Move, note: str | None) -> dict:
        return bot_comment(note or self.default_comment)

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Дебютная книга
        book = self._book_move(board)
        if book is not None:
            chosen_move, comment = book
            _simulate_human_thinking_time(board, is_book_move=True)
            san = board.san(chosen_move)
            board.push(chosen_move)
            return {
                "uci": chosen_move.uci(),
                "san": san,
                "fen_after": board.fen(),
                "source": "opening_book",
                "comment": comment,
            }

        _simulate_human_thinking_time(board, is_book_move=False)

        # 2. Кандидаты движка (или статического анализатора), 3. выбор по стилю
        candidates = self._candidate_scores(board)
        used_stockfish, engine_path = candidates.used_engine, candidates.engine_path
        best_move, note = self._select_move(board, candidates.scores, candidates.reference)
        comment = self._comment_for(board, best_move, note)

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
            "comment": comment,
        }
