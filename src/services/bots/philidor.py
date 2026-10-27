# --- FILE: src/services/bots/philidor.py ---

import random
import shutil
import chess
import chess.engine

# Дебютная книга Франсуа-Андре Филидора (на основе "Analyse du jeu des Échecs" 1749 г. и партий в Лондоне 1783-1795 гг.)
PHILIDOR_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {
    # === ЗА БЕЛЫХ ===
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": [
        ("e2e4", 100, "Пешка короля открывает путь слону и занимает центр."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f1c4", 65, "Дебют слона! Слон атакует пункт f7, не мешая пешке f2 идти вперёд."),
        ("f2f4", 35, "Королевский гамбит — подорвём центр соперника с фланга!"),
    ],
    "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Сначала c2-c3! Конь никогда не должен становиться впереди пешки c."),
    ],
    "rnbqk1nr/pppp1ppp/8/2b1p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("c2c3", 100, "Первая партия из моего трактата 1749 года: c2-c3 готовит мощный пешечный центр d2-d4!"),
    ],
    "rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq -": [
        ("d2d3", 60, "Укрепим пешку e4, чтобы затем подготовить c2-c3 и f2-f4."),
        ("d2d4", 40, "Немедленный удар по центру!"),
    ],
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": [
        ("f2f4", 80, "Против сицилианского построения сразу надвигаем пешку f4!"),
        ("f1c4", 20, "Выведем слона на активную диагональ."),
    ],

    # === ЗА ЧЁРНЫХ ===
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": [
        ("e7e5", 85, "Встретим пешку соперника в центре: e7-e5."),
        ("e7e6", 15, "Сыграем сдержанно e7-e6, готовя d7-d5."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": [
        ("d7d6", 100, "Моя фирменная защита (d7-d6)! Белые напрасно вывели коня на f3, заперев свою пешку f2."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq -": [
        ("f7f5", 65, "Контрудар f7-f5! Как я писал в «Анализе шахматной игры», перехватим инициативу пешками."),
        ("e5d4", 35, "Разменяем центральную пешку, удерживая прочный редут на d6."),
    ],
    "rnbqkbnr/ppp2ppp/3p4/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": [
        ("f7f5", 60, "Смело двигаем пешку f7-f5, вскрывая линию для ладьи после рокировки!"),
        ("c7c6", 40, "Подготовим d6-d5 с помощью пешки c6 (партия против графа Брюля, 1783 г.)."),
    ],
    "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq -": [
        ("c7c6", 70, "Сыграем c7-c6, чтобы следующим ходом захватить центр пешкой d7-d5!"),
        ("g8f6", 30, "Атакуем пешку e4."),
    ],
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -": [
        ("d7d5", 100, "Удержим равновесие в центре."),
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
        support_rank = r - 1 if us == chess.WHITE else r + 1
        if 0 <= support_rank <= 7:
            if (f > 0 and chess.square(f - 1, support_rank) in our_pawns) or \
                    (f < 7 and chess.square(f + 1, support_rank) in our_pawns):
                score += 10.0

    # Штраф за сдвоенные пешки
    doubled_pawns = len(pawn_files) - len(set(pawn_files))
    score -= float(doubled_pawns) * 20.0

    return score


# def evaluate_philidor_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
#     """
#     Доктрина Филидора: «Пешки — душа шахмат».
#     Оценивает ход с точки зрения контроля центра и гармонии пешечной структуры.
#     """
#     us = board_before.turn
#     piece = board_before.piece_at(move.from_square)
#     if not piece:
#         return 0.0, None
#
#     bonus = 0.0
#     note = None
#
#     # 1. Приоритет ходов пешками
#     if piece.piece_type == chess.PAWN:
#         bonus += 12.0
#         if move.to_square in CENTER_SQUARES:
#             bonus += 35.0
#             note = "Пешки — душа шахмат! Мощный удар в центр доски."
#         elif move.to_square in EXTENDED_CENTER:
#             bonus += 20.0
#             note = "Занимаем пространство пешечной фалангой."
#
#     # 2. Исторический запрет блокировать пешки 'c' и 'f' конями на ранней стадии
#     if piece.piece_type == chess.KNIGHT and board_before.fullmove_number <= 10:
#         if us == chess.WHITE:
#             if move.to_square == chess.C3 and board_before.piece_at(chess.C2) == chess.Piece(chess.PAWN, chess.WHITE):
#                 bonus -= 50.0  # Сурово штрафуем за нарушение принципа Филидора
#             if move.to_square == chess.F3 and board_before.piece_at(chess.F2) == chess.Piece(chess.PAWN, chess.WHITE):
#                 bonus -= 40.0
#         else:
#             if move.to_square == chess.C6 and board_before.piece_at(chess.C7) == chess.Piece(chess.PAWN, chess.BLACK):
#                 bonus -= 50.0
#             if move.to_square == chess.F6 and board_before.piece_at(chess.F7) == chess.Piece(chess.PAWN, chess.BLACK):
#                 bonus -= 40.0
#
#     # 3. Дельта пешечной структуры после хода
#     structure_before = _evaluate_pawn_structure(board_before, us)
#     board_after = board_before.copy()
#     board_after.push(move)
#     structure_after = _evaluate_pawn_structure(board_after, us)
#
#     bonus += (structure_after - structure_before)
#
#     return bonus, note
def evaluate_philidor_style_bonus(board_before: chess.Board, move: chess.Move) -> tuple[float, str | None]:
    us = board_before.turn
    piece = board_before.piece_at(move.from_square)
    if not piece:
        return 0.0, None

    bonus = 0.0
    note = None

    if piece.piece_type == chess.PAWN:
        bonus += 12.0
        if move.to_square in CENTER_SQUARES:
            bonus += 35.0
            note = "Пешки — душа шахмат! Мощный удар в центр доски."
        elif move.to_square in EXTENDED_CENTER:
            bonus += 20.0
            note = "Занимаем пространство пешечной фалангой."
        elif move.to_square in {chess.C3, chess.C6, chess.D3, chess.D6}:
            bonus += 15.0  # Гарантируем уверенный плюс за подготовку центра по методу Филидора
            note = "Подготавливаем продвижение центральной пешки по методу Филидора."

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
        self.skill_level = skill_level  # Уровень силы (от 0 до 20)

    def choose_move(self, fen: str) -> dict:
        board = chess.Board(fen)
        if board.is_game_over():
            raise ValueError("Game is already over")

        # 1. Проверяем дебютную книгу
        fen_key = normalize_fen_key(board)
        if fen_key in PHILIDOR_OPENING_BOOK:
            candidates = PHILIDOR_OPENING_BOOK[fen_key]
            valid_book_moves = []
            for uci_str, weight, comment in candidates:
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

        # 2. Получаем тактическую оценку ходов от Stockfish с увеличенной глубиной
        base_scores: dict[chess.Move, float] = {}
        if self.stockfish_path:
            try:
                with chess.engine.SimpleEngine.popen_uci(self.stockfish_path) as engine:
                    # Настраиваем силу бота (Skill Level) для вариативности и устранения примитивных ошибок
                    engine.configure({"Skill Level": self.skill_level})

                    # Увеличиваем глубину до 12, чтобы бот видел тактику
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
            # Небольшой элемент человеческого фактора (jitter), чтобы ходы не были одинаковыми
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
