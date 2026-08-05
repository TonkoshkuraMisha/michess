import chess
import chess.pgn
import io


class GameEngine:
    @staticmethod
    def process_move(pgn_text: str | None, move_str: str) -> tuple[bool, str, str | None]:
        """
        Проверяет ход, применяет его к текущей партии и возвращает новый статус.
        Поддерживает форматы UCI (e2e4) и SAN (Nf3).

        Возвращает: (is_valid, new_pgn, result)
        result = "1-0", "0-1", "1/2-1/2" или None (если игра продолжается)
        """
        # 1. Восстанавливаем состояние доски из PGN (или создаем новую)
        if pgn_text:
            game = chess.pgn.read_game(io.StringIO(pgn_text))
            board = game.end().board()
        else:
            game = chess.pgn.Game()
            board = game.board()

        # 2. Пытаемся распарсить ход
        try:
            # Сначала пробуем парсить как UCI (например, e2e4)
            move = chess.Move.from_uci(move_str)
            if move not in board.legal_moves:
                # Если не UCI, пробуем SAN (например, Nf3)
                move = board.parse_san(move_str)
        except ValueError:
            return False, pgn_text or "", None

        if move not in board.legal_moves:
            return False, pgn_text or "", None

        # 3. Делаем ход и добавляем его в дерево партии
        if pgn_text:
            game.end().add_main_variation(move)
        else:
            game.add_variation(move)

        board.push(move)

        # 4. Проверяем, не закончилась ли партия
        result = None
        if board.is_checkmate():
            # Если мат, выигрывает тот, кто только что ходил (ход уже передан оппоненту)
            result = "1-0" if board.turn == chess.BLACK else "0-1"
        elif board.is_game_over():
            result = "1/2-1/2"

        # 5. Генерируем обновленную PGN-строку
        exporter = chess.pgn.StringExporter(headers=False, variations=False, comments=False)
        new_pgn = game.accept(exporter)

        return True, new_pgn, result


engine = GameEngine()