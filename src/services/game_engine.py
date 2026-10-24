# --- FILE: src/services/game_engine.py ---

import chess

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


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
        safe_fen = fen.strip() if fen and fen.strip() else STARTING_FEN
        try:
            board = chess.Board(safe_fen)
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
        is_game_over = board.is_game_over(claim_draw=True)
        result = None
        termination = None

        if is_game_over:
            res = board.result(claim_draw=True)
            result = res if res != "*" else None

            if board.is_checkmate():
                termination = "checkmate"
            elif board.is_stalemate():
                termination = "stalemate"
            elif board.is_insufficient_material():
                termination = "insufficient_material"
            elif board.is_fifty_moves():
                termination = "50_move_rule"
            elif board.is_repetition():
                termination = "repetition"
            else:
                termination = "draw"

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
