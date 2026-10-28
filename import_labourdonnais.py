# --- FILE: import_labourdonnais.py ---

import os
import json
import chess.pgn


def import_folder_pgns(folder_path: str):
    book_additions = {}

    if not os.path.exists(folder_path):
        print(f"[-] Папка не найдена: {folder_path}")
        return book_additions

    files = [f for f in os.listdir(folder_path) if f.endswith('.pgn')]
    print(f"[+] Найдено PGN файлов в папке: {len(files)}")

    game_count = 0
    for filename in files:
        filepath = os.path.join(folder_path, filename)
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            while True:
                try:
                    game = chess.pgn.read_game(f)
                    if game is None:
                        break
                    game_count += 1

                    board = game.board()
                    ply = 0
                    for move in game.mainline_moves():
                        if ply >= 10:  # Первые 5 полных ходов для дебютной книги
                            break

                        parts = board.fen().split(" ")
                        fen_key = f"{parts[0]} {parts[1]} {parts[2]} -"
                        uci = move.uci()

                        if fen_key not in book_additions:
                            book_additions[fen_key] = {}

                        book_additions[fen_key][uci] = book_additions[fen_key].get(uci, 0) + 1

                        try:
                            board.push(move)
                        except ValueError:
                            break
                        ply += 1
                except Exception:
                    continue

    print(f"[+] Успешно обработано партий Лабурдонне: {game_count}")
    print(f"[+] Найдено уникальных позиций: {len(book_additions)}")

    formatted_book = {}
    for fen, moves_dict in book_additions.items():
        sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
        total_count = sum(moves_dict.values())

        moves_list = []
        for uci, count in sorted_moves:
            weight = int((count / total_count) * 100)
            comment = f"Любимый ход Лабурдонне в атаке (встречалось в партиях: {count} раз(а))."
            moves_list.append((uci, max(weight, 1), comment))
        formatted_book[fen] = moves_list

    return formatted_book


if __name__ == "__main__":
    folder = r"C:\Users\misha\Downloads\Louis de La Bourdonnais"
    book_data = import_folder_pgns(folder)

    if book_data:
        output_path = "labourdonnais_generated_book.json"
        with open(output_path, "w", encoding="utf-8") as out_f:
            json.dump(book_data, out_f, ensure_ascii=False, indent=4)
        print(f"[+] Дебютная книга Лабурдонне сохранена в {output_path}")
