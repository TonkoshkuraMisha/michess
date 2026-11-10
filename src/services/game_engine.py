# --- FILE: src/services/game_engine.py ---

import logging

import chess

logger = logging.getLogger(__name__)

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def restore_board(fen: str, pgn_movetext: str = "") -> chess.Board:
    """
    Восстанавливает доску вместе с историей ходов.

    История нужна для правил повторения позиции (троекратное / пятикратное), которые
    невозможно проверить по одному FEN. Ходы переигрываются из PGN-строки партии
    («1. e4 e5 2. Nf3 ...») от стартовой позиции. Если PGN пуст, повреждён или не
    приводит к переданному FEN, используется доска из FEN без истории.
    """
    safe_fen = fen.strip() if fen and fen.strip() else STARTING_FEN
    movetext = (pgn_movetext or "").strip()

    if movetext:
        board = chess.Board()
        try:
            for token in movetext.split():
                # Номера ходов («12.», «12...») и результат («1-0») начинаются с цифры, SAN — никогда.
                if token[0].isdigit() or token == "*":
                    continue
                board.push_san(token)
        except ValueError as exc:
            logger.warning("Cannot replay PGN history (%s), falling back to FEN-only board", exc)
        else:
            if board.fen() == safe_fen:
                return board
            logger.warning("Replayed PGN does not match stored FEN, falling back to FEN-only board")

    return chess.Board(safe_fen)


def terminal_outcome(board: chess.Board) -> tuple[str, str] | None:
    """
    Итог партии по позиции на доске (с историей ходов) или None, если партия продолжается.

    Ничьи по повторению и правилу 50 ходов фиксируются автоматически, но только по фактически
    сложившейся позиции. board.is_game_over(claim_draw=True) здесь не подходит: он засчитывает
    ничью и тогда, когда повторение лишь достижимо следующим ходом.
    """
    if not (board.is_game_over() or board.is_repetition(3) or board.is_fifty_moves()):
        return None
    if board.is_checkmate():
        return ("0-1" if board.turn == chess.WHITE else "1-0"), "checkmate"
    if board.is_stalemate():
        return "1/2-1/2", "stalemate"
    if board.is_insufficient_material():
        return "1/2-1/2", "insufficient_material"
    if board.is_fifty_moves():
        return "1/2-1/2", "50_move_rule"
    if board.is_repetition(3):
        return "1/2-1/2", "repetition"
    return "1/2-1/2", "draw"


def side_has_mating_material(board_fen: str | None, color: str) -> bool:
    """
    Может ли color в принципе поставить мат какой-либо последовательностью легальных ходов
    (по материалу, с учётом цвета полей слонов). Если FEN не разбирается — считаем, что может.
    """
    try:
        board = chess.Board(board_fen or STARTING_FEN)
    except ValueError:
        return True
    return not board.has_insufficient_material(chess.WHITE if color == "white" else chess.BLACK)


FLAG_DRAW_TERMINATION = "timeout_vs_insufficient_material"


def flag_outcome(board_fen: str | None, flagged_color: str) -> tuple[str, str]:
    """
    Итог партии, когда у flagged_color кончилось время (правило ФИДЕ 6.9).

    Поражение, если только у соперника нет материала, которым мат невозможен никакой
    последовательностью легальных ходов, — тогда ничья. has_insufficient_material учитывает
    только материал (и цвета полей слонов) и гарантированно не объявит ничью там, где мат
    возможен: например, конь против ладьи — победа (кооперативный мат существует).
    Возвращает (result, termination).
    """
    winner = "black" if flagged_color == "white" else "white"
    if not side_has_mating_material(board_fen, winner):
        return "1/2-1/2", FLAG_DRAW_TERMINATION
    return ("0-1" if flagged_color == "white" else "1-0"), "timeout"


class GameEngine:
    @staticmethod
    def process_move(fen: str, move_str: str, current_pgn: str = "") -> tuple[bool, dict | None]:
        """
        Проверяет ход, применяет его к текущей позиции (FEN) и возвращает новые данные.

        Возвращает: (is_valid, move_data)
        Где move_data содержит:
        - new_fen: str (Новое состояние доски)
        - new_pgn: str (Обновленная строка ходов PGN)
        - san: str (Красивая нотация, например "Nf3")
        - uci: str (Универсальная нотация, например "g1f3")
        - fullmove_number: int (Номер хода)
        - is_obvious: bool (Флаг единственного легального хода для античита)
        - is_game_over: bool
        - result: str | None ("1-0", "0-1", "1/2-1/2")
        - termination: str | None ("checkmate", "stalemate", "repetition", etc.)
        """
        try:
            board = restore_board(fen, current_pgn)
        except ValueError:
            return False, None

        # 1. Пытаемся распарсить ход (UCI или SAN)
        move = None
        try:
            candidate = chess.Move.from_uci(move_str)
            if candidate in board.legal_moves:
                move = candidate
        except ValueError:
            pass

        if move is None:
            try:
                candidate = board.parse_san(move_str)
                if candidate in board.legal_moves:
                    move = candidate
            except ValueError:
                return False, None

        if move is None or move not in board.legal_moves:
            return False, None

        # 2. Собираем метаданные ДО выполнения хода
        legal_moves_count = board.legal_moves.count()
        is_obvious = legal_moves_count == 1
        is_white_turn = board.turn == chess.WHITE
        fullmove_number = board.fullmove_number

        san = board.san(move)
        uci = move.uci()

        # Формируем PGN-строку за O(1) без перестроения всего дерева
        pgn_base = (current_pgn or "").strip()
        if is_white_turn:
            move_token = f"{fullmove_number}. {san}"
        else:
            move_token = san if pgn_base else f"{fullmove_number}... {san}"
        new_pgn = f"{pgn_base} {move_token}".strip()

        # 3. Применяем ход на доске
        board.push(move)
        new_fen = board.fen()

        # 4. Проверяем условия завершения партии
        outcome = terminal_outcome(board)
        is_game_over = outcome is not None
        result, termination = outcome if outcome else (None, None)

        return True, {
            "new_fen": new_fen,
            "new_pgn": new_pgn,
            "san": san,
            "uci": uci,
            "fullmove_number": fullmove_number,
            "is_obvious": is_obvious,
            "is_game_over": is_game_over,
            "result": result,
            "termination": termination
        }


engine = GameEngine()
