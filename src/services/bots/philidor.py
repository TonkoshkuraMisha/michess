# --- FILE: src/services/bots/philidor.py ---

import random
import shutil
import chess
import chess.engine

# Дебютная книга Франсуа-Андре Филидора (на основе анализа партий из исторической базы)
PHILIDOR_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {
    "rnbqkbnr/ppppp1pp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 96, "Исторический выбор Филидора (встречалось в партиях: 24 раз(а))."),
        ("d2d4", 4, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppppp1pp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("0000", 54, "Исторический выбор Филидора (встречалось в партиях: 13 раз(а))."),
        ("g8h6", 20, "Исторический выбор Филидора (встречалось в партиях: 5 раз(а))."),
        ("e7e6", 12, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
        ("c7c5", 12, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("d2d4", 66, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
        ("f1c4", 33, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
    ],
    "rnbqkbnr/ppp3pp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq -": [
        ("e4d5", 50, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
        ("e4e5", 50, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppp3pp/4p3/3P4/3P4/8/PPP2PPP/RNBQKBNR b KQkq -": [
        ("e6d5", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppp3pp/8/3p4/3P4/8/PPP2PPP/RNBQKBNR w KQkq -": [
        ("d1h5", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppp3pp/8/3p3Q/3P4/8/PPP2PPP/RNB1KBNR b KQkq -": [
        ("g7g6", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppp4p/6p1/3p3Q/3P4/8/PPP2PPP/RNB1KBNR w KQkq -": [
        ("h5e5", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppp4p/6p1/3pQ3/3P4/8/PPP2PPP/RNB1KBNR b KQkq -": [
        ("d8e7", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f1c4", 62, "Исторический выбор Филидора (встречалось в партиях: 5 раз(а))."),
        ("f2f4", 37, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("c7c6", 80, "Исторический выбор Филидора (встречалось в партиях: 4 раз(а))."),
        ("g8f6", 20, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1p1ppp/2p5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d1e2", 50, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
        ("b1c3", 25, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
        ("g1f3", 25, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1p1ppp/2p5/4p3/2B1P3/8/PPPPQPPP/RNB1K1NR b KQkq -": [
        ("d7d6", 50, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
        ("g8f6", 50, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f2f4", 66, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
        ("f1c4", 33, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("e7e6", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1p1ppp/4p3/2p5/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d1e2", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pp1p1ppp/4p3/2p5/2B1P3/8/PPPPQPPP/RNB1K1NR b KQkq -": [
        ("b8c6", 100, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkb1r/ppppp1pp/7n/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("d2d4", 60, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
        ("f1c4", 40, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
    ],
    "rnbqkb1r/ppppp1pp/7n/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq -": [
        ("h6f7", 100, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkb1r/pppppnpp/8/8/3PP3/8/PPP2PPP/RNBQKBNR w KQkq -": [
        ("f1d3", 66, "Исторический выбор Филидора (встречалось в партиях: 2 раз(а))."),
        ("f1c4", 33, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/ppppp1pp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("d2d4", 61, "Исторический выбор Филидора (встречалось в партиях: 8 раз(а))."),
        ("f2f4", 38, "Исторический выбор Филидора (встречалось в партиях: 5 раз(а))."),
    ],
    "rnbqkbnr/ppppp1pp/8/8/4PP2/8/PPPP2PP/RNBQKBNR b KQkq -": [
        ("e7e6", 100, "Исторический выбор Филидора (встречалось в партиях: 5 раз(а))."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/4PP2/8/PPPP2PP/RNBQKBNR w KQkq -": [
        ("d2d4", 80, "Исторический выбор Филидора (встречалось в партиях: 4 раз(а))."),
        ("g1f3", 20, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/3PPP2/8/PPP3PP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Исторический выбор Филидора (встречалось в партиях: 11 раз(а))."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq -": [
        ("e5f4", 100, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq -": [
        ("g1f3", 100, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkbnr/pppp1ppp/8/8/4Pp2/5N2/PPPP2PP/RNBQKB1R b KQkq -": [
        ("g7g5", 100, "Исторический выбор Филидора (встречалось в партиях: 3 раз(а))."),
    ],
    "rnbqkbnr/ppppp1pp/8/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq -": [
        ("e7e6", 100, "Исторический выбор Филидора (встречалось в партиях: 8 раз(а))."),
    ],
    "rnbqkbnr/pppp2pp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR w KQkq -": [
        ("f2f4", 87, "Исторический выбор Филидора (встречалось в партиях: 7 раз(а))."),
        ("c2c4", 12, "Исторический выбор Филидора (встречалось в партиях: 1 раз(а))."),
    ],
}

CENTER_SQUARES = {chess.D4, chess.E4, chess.D5, chess.E5}
EXTENDED_CENTER = {chess.C4, chess.D4, chess.E4, chess.F4, chess.C5, chess.D5, chess.E5, chess.F5}

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}


def normalize_fen_key(board: chess.Board) -> str:
    parts = board.fen().split(" ")
    return f"{parts[0]} {parts[1]} {parts[2]} -"


def _evaluate_pawn_structure(board: chess.Board, us: chess.Color) -> float:
    """Улучшенная оценка пешечной структуры: фаланги, цепи и избежание сдвоенных пешек."""
    our_pawns = board.pieces(chess.PAWN, us)
    start_rank = 1 if us == chess.WHITE else 6
    pawn_files = [chess.square_file(sq) for sq in our_pawns]

    score = 0.0
    for sq in our_pawns:
        f = chess.square_file(sq)
        r = chess.square_rank(sq)

        # Бонус за продвижение пешек к центру и дальше
        if r != start_rank:
            score += float(r if us == chess.WHITE else (7 - r)) * 3.0

        # Пешечные фаланги (соседние пешки на одной горизонтали)
        if f < 7 and chess.square(f + 1, r) in our_pawns:
            score += 15.0

        # Пешечные цепи (поддержка сзади)
        support_rank = (r - 1) if us == chess.WHITE else (r + 1)
        if 0 <= support_rank <= 7:
            if (f > 0 and chess.square(f - 1, support_rank) in our_pawns) or \
                    (f < 7 and chess.square(f + 1, support_rank) in our_pawns):
                score += 10.0

    # Штраф за сдвоенные пешки
    doubled_pawns = len(pawn_files) - len(set(pawn_files))
    score -= float(doubled_pawns) * 20.0

    return score


def evaluate_philidor_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    """
    Доктрина Филидора: «Пешки — душа шахмат».
    Оценивает ход с точки зрения контроля центра и гармонии пешечной структуры.
    """
    us = board_before.turn
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    # 1. Приоритет ходов пешками
    if piece.piece_type == chess.PAWN:
        bonus += 12.0
        if move.to_square in CENTER_SQUARES:
            bonus += 35.0
            note = "Пешки — душа шахмат! Мощный удар в центр доски."
        elif move.to_square in EXTENDED_CENTER:
            bonus += 20.0
            note = "Занимаем пространство пешечной фалангой."
        elif move.to_square in {chess.C3, chess.C6, chess.D3, chess.D6}:
            bonus += 15.0
            note = "Подготавливаем продвижение центральной пешки по методу Филидора."

    # 2. Исторический запрет блокировать пешки 'c' и 'f' конями на ранней стадии
    if piece.piece_type == chess.KNIGHT and board_before.fullmove_number <= 10:
        if us == chess.WHITE:
            if move.to_square == chess.C3 and board_before.piece_at(chess.C2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 50.0
            if move.to_square == chess.F3 and board_before.piece_at(chess.F2) == chess.Piece(chess.PAWN, chess.WHITE):
                bonus -= 40.0
        else:
            if move.to_square == chess.C6 and board_before.piece_at(chess.C7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 50.0
            if move.to_square == chess.F6 and board_before.piece_at(chess.F7) == chess.Piece(chess.PAWN, chess.BLACK):
                bonus -= 40.0

    # 3. Дельта пешечной структуры после хода
    structure_before = _evaluate_pawn_structure(board_before, us)
    board_after = board_before.copy()
    board_after.push(move)
    structure_after = _evaluate_pawn_structure(board_after, us)

    bonus += (structure_after - structure_before)

    return bonus, note


def static_board_eval_cp(board: chess.Board, perspective: chess.Color) -> float:
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


class PhilidorBot:
    """
    Усиленный исторический бот Франсуа-Андре Филидора.
    Использует глубокий поиск Stockfish (depth=12, skill=12) с наложением позиционных принципов Филидора.
    """

    def __init__(self, stockfish_path: str | None = None, skill_level: int = 12):
        self.stockfish_path = stockfish_path or shutil.which("stockfish")
        self.skill_level = skill_level

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Проверяем дебютную книгу
        fen_key = normalize_fen_key(board)
        if fen_key in PHILIDOR_OPENING_BOOK:
            candidates = PHILIDOR_OPENING_BOOK[fen_key]
            valid_book_moves = []
            for item in candidates:
                uci_str, weight, comment = item[0], item[1], item[2]
                move = chess.Move.from_uci(uci_str)
                if move in board.legal_moves:
                    valid_book_moves.append((move, weight, comment))

            if valid_book_moves:
                moves, weights, comments = zip(*valid_book_moves)
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

        # 2. Получаем тактическую оценку ходов от Stockfish
        base_scores: dict[chess.Move, float] = {}
        if self.stockfish_path:
            try:
                with chess.engine.SimpleEngine.popen_uci(self.stockfish_path) as engine:
                    engine.configure({"Skill Level": self.skill_level})
                    infos = engine.analyse(
                        board,
                        chess.engine.Limit(depth=12, time=0.3),
                        multipv=min(8, board.legal_moves.count()),
                    )
                    for info in infos:
                        pv = info.get("pv")
                        if pv:
                            mv = pv[0]
                            cp = info["score"].pov(board.turn).score(mate_score=100000) or 0
                            base_scores[mv] = float(cp)
            except Exception:
                base_scores = {}

        # Fallback: Углубленный тактический расчёт (если нет движка)
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

        # 3. Применяем стилевую оценку Филидора поверх расчётов движка
        best_move = None
        best_total_score = -float("inf")
        best_comment = None

        for mv, tactical_cp in base_scores.items():
            style_bonus, note = evaluate_philidor_style_bonus(board, mv)
            jitter = random.uniform(-3.0, 3.0)
            total_score = tactical_cp + style_bonus + jitter

            if total_score > best_total_score:
                best_total_score = total_score
                best_move = mv
                best_comment = note

        if best_move is None:
            best_move = next(iter(board.legal_moves))

        san = board.san(best_move)
        board.push(best_move)

        return {
            "uci": best_move.uci(),
            "san": san,
            "fen_after": board.fen(),
            "source": "philidor_style_engine_deep",
            "comment": best_comment or "Пешки — душа шахмат. Строим несокрушимую пешечную цепь.",
        }


philidor_bot = PhilidorBot()
