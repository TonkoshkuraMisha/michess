# --- FILE: src/services/analysis_service.py ---

import asyncio
import contextlib
import io
import json
import logging
import math
import os
import chess
import chess.engine
import chess.pgn
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game, GameStatus
from src.services.bots.base import resolve_stockfish_path, static_board_eval_cp
from src.services.engine_pool import EngineUnavailableError, get_engine_pool

logger = logging.getLogger(__name__)


def classify_move_by_cp_loss(cp_loss: int, is_best_move: bool = False) -> tuple[str, str]:
    """
    Классифицирует ход по потере сантипешек (cp_loss):
    - Best: 0..10 cp (или точное совпадение с первой линией движка)
    - Good: 11..45 cp
    - Inaccuracy (?!): 46..95 cp
    - Mistake (?): 96..199 cp
    - Blunder (??): >= 200 cp
    """
    loss = max(0, int(cp_loss))
    if is_best_move or loss <= 10:
        return "Best", "!"
    if loss <= 45:
        return "Good", ""
    if loss <= 95:
        return "Inaccuracy", "?!"
    if loss < 200:
        return "Mistake", "?"
    return "Blunder", "??"


def calculate_move_accuracy(cp_loss: int) -> float:
    """Формула точности одного хода (0..100%) на основе потери сантипешек."""
    loss = max(0.0, float(cp_loss))
    raw = 103.1668 * math.exp(-0.004 * loss) - 3.1669
    return round(max(0.0, min(100.0, raw)), 1)


def calculate_accuracy(cp_losses: list[int]) -> float:
    """Рассчитывает общую точность игрока в партии (0..100%) по списку потерь сантипешек."""
    if not cp_losses:
        return 100.0
    per_move = [calculate_move_accuracy(loss) for loss in cp_losses]
    return round(sum(per_move) / len(per_move), 1)


def format_eval_display(eval_white_cp: int, mate_white: int | None = None) -> str:
    """Форматирует оценку с точки зрения Белых для шкалы EvalBar (+1.4, -0.8, M3, -M2)."""
    if mate_white is not None and mate_white != 0:
        return f"M{mate_white}" if mate_white > 0 else f"-M{abs(mate_white)}"
    pawns = eval_white_cp / 100.0
    sign = "+" if pawns > 0 else ""
    return f"{sign}{pawns:.1f}"


def _evaluate_board_sequence_sync(pgn_text: str, depth: int = 10) -> dict:
    """Синхронный проход по всем позициям партии со Stockfish или статическим fallback-оценщиком."""
    pgn_game = chess.pgn.read_game(io.StringIO(pgn_text))
    if pgn_game is None:
        raise ValueError("Не удалось распарсить PGN партии")

    board = pgn_game.board()
    mainline_moves = list(pgn_game.mainline_moves())

    sf_path = resolve_stockfish_path()
    engine = None
    engine_label = "Static Fallback Evaluator"
    engine_stack = contextlib.ExitStack()

    if sf_path and os.path.exists(sf_path):
        # EngineBusyError намеренно не перехватывается: под нагрузкой лучше вернуть 503, чем
        # закэшировать в БД анализ статическим оценщиком вместо Stockfish.
        try:
            engine = engine_stack.enter_context(get_engine_pool(sf_path).acquire())
            engine_label = engine.id.get("name", "Stockfish")
        except EngineUnavailableError as exc:
            logger.warning("Не удалось запустить Stockfish (%s), используем fallback: %s", sf_path, exc)
            engine = None

    # Оценки каждой позиции с точки зрения Белых (индекс 0 = стартовая позиция)
    evals_white_cp: list[int] = []
    mates_white: list[int | None] = []
    best_moves_uci: list[str | None] = []

    def eval_single_board(b: chess.Board) -> tuple[int, int | None, str | None]:
        if b.is_checkmate():
            mate_val = -1 if b.turn == chess.WHITE else 1
            cp_val = -10000 if b.turn == chess.WHITE else 10000
            return cp_val, mate_val, None
        if b.is_game_over():
            return 0, None, None

        if engine is not None:
            try:
                info = engine.analyse(b, chess.engine.Limit(depth=depth, time=0.06))
                if isinstance(info, list):
                    info = info[0]
                pov_white = info["score"].white()
                mate = pov_white.mate()
                cp = pov_white.score(mate_score=10000) or 0
                cp = max(-2000, min(2000, int(cp)))
                pv = info.get("pv")
                best_uci = pv[0].uci() if pv else None
                return cp, mate, best_uci
            except Exception:
                pass

        # Fallback без бинарника Stockfish
        best_uci = None
        best_side_score = -100000.0
        for candidate in b.legal_moves:
            b_copy = b.copy()
            b_copy.push(candidate)
            sc = static_board_eval_cp(b_copy, b.turn)
            if sc > best_side_score:
                best_side_score = sc
                best_uci = candidate.uci()

        white_cp = int(static_board_eval_cp(b, chess.WHITE))
        white_cp = max(-2000, min(2000, white_cp))
        return white_cp, None, best_uci

    try:
        cp0, mate0, best0 = eval_single_board(board)
        evals_white_cp.append(cp0)
        mates_white.append(mate0)
        best_moves_uci.append(best0)

        san_list: list[str] = []
        uci_list: list[str] = []
        colors: list[str] = []

        for mv in mainline_moves:
            colors.append("white" if board.turn == chess.WHITE else "black")
            san_list.append(board.san(mv))
            uci_list.append(mv.uci())
            board.push(mv)
            cp_i, mate_i, best_i = eval_single_board(board)
            evals_white_cp.append(cp_i)
            mates_white.append(mate_i)
            best_moves_uci.append(best_i)
    finally:
        engine_stack.close()  # возвращает движок в пул

    moves_report: list[dict] = []
    white_losses: list[int] = []
    black_losses: list[int] = []

    counts = {
        "white": {"Best": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0},
        "black": {"Best": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0},
    }

    for idx, uci_played in enumerate(uci_list):
        mover_color = colors[idx]
        before_white_cp = evals_white_cp[idx]
        after_white_cp = evals_white_cp[idx + 1]
        after_mate = mates_white[idx + 1]
        recommended_uci = best_moves_uci[idx]

        if mover_color == "white":
            cp_loss = max(0, before_white_cp - after_white_cp)
            white_losses.append(cp_loss)
        else:
            cp_loss = max(0, after_white_cp - before_white_cp)
            black_losses.append(cp_loss)

        is_exact_best = recommended_uci is not None and recommended_uci == uci_played
        if is_exact_best:
            cp_loss = 0

        label, symbol = classify_move_by_cp_loss(cp_loss, is_best_move=is_exact_best)
        counts[mover_color][label] += 1

        moves_report.append({
            "ply": idx + 1,
            "move_number": (idx // 2) + 1,
            "color": mover_color,
            "san": san_list[idx],
            "uci": uci_played,
            "eval_cp": after_white_cp,
            "eval_display": format_eval_display(after_white_cp, after_mate),
            "mate": after_mate,
            "best_move_uci": recommended_uci,
            "cp_loss": cp_loss,
            "classification": label,
            "symbol": symbol,
        })

    def build_side_summary(losses: list[int], side_counts: dict[str, int]) -> dict:
        avg_loss = round(sum(losses) / len(losses), 1) if losses else 0.0
        return {
            "accuracy": calculate_accuracy(losses),
            "best": side_counts["Best"],
            "good": side_counts["Good"],
            "inaccuracies": side_counts["Inaccuracy"],
            "mistakes": side_counts["Mistake"],
            "blunders": side_counts["Blunder"],
            "avg_cp_loss": avg_loss,
        }

    return {
        "engine": engine_label,
        "white": build_side_summary(white_losses, counts["white"]),
        "black": build_side_summary(black_losses, counts["black"]),
        "moves": moves_report,
    }


class GameNotFinishedError(Exception):
    """Анализ идущей партии запрещён: он работал бы как подсказка движка игрокам."""


_FINISHED_STATUSES = (GameStatus.COMPLETED, GameStatus.ABORTED)


def ensure_game_finished(game: Game) -> None:
    if game.status not in _FINISHED_STATUSES:
        raise GameNotFinishedError(f"Партия {game.id} ещё не завершена")


def _count_mainline_plies(pgn_text: str) -> int:
    pgn_game = chess.pgn.read_game(io.StringIO(pgn_text))
    if pgn_game is None:
        return -1
    return sum(1 for _ in pgn_game.mainline_moves())


class AnalysisService:
    async def analyze_position(self, db: AsyncSession, moves: list[str]) -> dict:
        board = chess.Board()
        for move_str in moves:
            try:
                board.push_san(move_str)
            except ValueError:
                try:
                    board.push_uci(move_str)
                except ValueError:
                    break

        sf_path = resolve_stockfish_path()
        eval_cp = int(static_board_eval_cp(board, chess.WHITE))
        best_move = None

        if sf_path and os.path.exists(sf_path) and not board.is_game_over():
            def _run_pos():
                with get_engine_pool(sf_path).acquire() as eng:
                    info = eng.analyse(board, chess.engine.Limit(depth=10, time=0.1))
                    if isinstance(info, list):
                        info = info[0]
                    cp = info["score"].white().score(mate_score=10000) or 0
                    pv = info.get("pv")
                    return int(cp), (pv[0].uci() if pv else None)

            try:
                eval_cp, best_move = await asyncio.to_thread(_run_pos)
            except EngineUnavailableError as exc:
                logger.warning("Stockfish недоступен, отдаём статическую оценку: %s", exc)

        return {
            "fen": board.fen(),
            "evaluation_cp": eval_cp,
            "evaluation_pawns": round(eval_cp / 100.0, 2),
            "best_move": best_move,
        }

    async def analyze_full_game(self, db: AsyncSession, game_id: int, force: bool = False) -> dict:
        result = await db.execute(select(Game).where(Game.id == game_id))
        game = result.scalars().first()
        if not game or not game.pgn:
            raise LookupError(f"Партия {game_id} или её PGN не найдены")
        ensure_game_finished(game)

        # Если анализ уже сохранён в БД и не запрошен пересчёт — отдаём мгновенно из кэша
        cached_raw = getattr(game, "analysis_json", None)
        if cached_raw and not force:
            try:
                cached_data = json.loads(cached_raw)
                if (
                        isinstance(cached_data, dict)
                        and "moves" in cached_data
                        and len(cached_data["moves"]) == _count_mainline_plies(game.pgn)
                ):
                    cached_data["game_id"] = game_id
                    return cached_data
                # Кэш не соответствует итоговому PGN (например, сохранён по незавершённой партии
                # до запрета анализа идущих игр) — пересчитываем.
            except Exception:
                pass

        report = await asyncio.to_thread(_evaluate_board_sequence_sync, game.pgn, 10)
        report["game_id"] = game_id

        if hasattr(game, "analysis_json"):
            try:
                game.analysis_json = json.dumps(report, ensure_ascii=False)
                await db.commit()
            except Exception as exc:
                await db.rollback()
                logger.warning("Не удалось сохранить кэш анализа в БД: %s", exc)

        return report


analysis_service = AnalysisService()
