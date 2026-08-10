# --- FILE: src/services/game_engine.py ---

import chess


class GameEngine:
    @staticmethod
    def process_move(fen: str, move_str: str) -> tuple[bool, dict | None]:
        """
        Проверяет ход, применяет его к текущей позиции (FEN) и возвращает новые данные.

        Возвращает: (is_valid, move_data)
        Где move_data содержит:
        - new_fen: str (Новое состояние доски)
        - san: str (Красивая нотация, например "Nf3")
        - uci: str (Универсальная нотация, например "g1f3")
        - is_game_over: bool
        - result: str | None ("1-0", "0-1", "1/2-1/2")
        - termination: str | None ("checkmate", "stalemate", "repetition", etc.)
        """
        board = chess.Board(fen)

        # 1. Пытаемся распарсить ход
        try:
            move = chess.Move.from_uci(move_str)
            if move not in board.legal_moves:
                move = board.parse_san(move_str)
        except ValueError:
            return False, None

        if move not in board.legal_moves:
            return False, None

        # 2. Извлекаем SAN до того, как сделаем ход (иначе контекст изменится)
        san = board.san(move)
        uci = move.uci()

        # 3. Делаем ход
        board.push(move)
        new_fen = board.fen()

        # 4. Проверяем завершение партии
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
                termination = "unknown"

        return True, {
            "new_fen": new_fen,
            "san": san,
            "uci": uci,
            "is_game_over": is_game_over,
            "result": result,
            "termination": termination
        }


engine = GameEngine()