# --- FILE: import_philidor.py ---

import json
import os
import chess.pgn


def import_philidor_pgn(pgn_file_path: str):
    """Скрипт для извлечения дебютных позиций Филидора из PGN-файла."""
    book_additions = {}

    if not os.path.exists(pgn_file_path):
        print(f"[-] Файл не найден: {pgn_file_path}")
        return book_additions

    with open(pgn_file_path, 'r', encoding='utf-8') as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break

            board = game.board()
            node = game
            # Берем первые 6 полуходов (3 полных хода) из каждой исторической партии
            for _ in range(6):
                if not node.variations:
                    break
                next_node = node.variations[0]
                move = next_node.move

                parts = board.fen().split(" ")
                fen_key = f"{parts[0]} {parts[1]} {parts[2]} -"

                uci = move.uci()
                if fen_key not in book_additions:
                    book_additions[fen_key] = {}

                book_additions[fen_key][uci] = book_additions[fen_key].get(uci, 0) + 1
                board.push(move)
                node = next_node

    print(f"[+] Успешно обработано позиций из базы PGN: {len(book_additions)}")
    return book_additions


if __name__ == "__main__":
    # Укажи точное имя твоего PGN-файла с партиями Филидора
    pgn_path = "Все партии Франсуа-Андре Филидора в формате pgn.pgn"

    data = import_philidor_pgn(pgn_path)

    if data:
        # Сохраняем результат в JSON-файл в корень проекта
        output_path = "philidor_generated_book.json"
        with open(output_path, "w", encoding="utf-8") as out_f:
            json.dump(data, out_f, ensure_ascii=False, indent=4)
        print(f"[+] Дебютная книга успешно сохранена в файл: {output_path}")
