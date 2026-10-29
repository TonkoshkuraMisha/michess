# --- FILE: import_labourdonnais.py ---

import json
import os
import chess.pgn

DEFAULT_FOLDER = "downloaded_pgns/labourdonnais"
OUTPUT_JSON_PATH = "labourdonnais_generated_book.json"
BOT_FILE_PATH = "src/services/bots/labourdonnais.py"


def import_folder_pgns(folder_path: str, bot_file_path: str = BOT_FILE_PATH):
    book_additions: dict[str, dict[str, int]] = {}

    if not os.path.exists(folder_path):
        print(f"[-] Папка не найдена: {folder_path}")
        return book_additions

    files = [f for f in os.listdir(folder_path) if f.endswith(".pgn")]
    print(f"[+] Найдено PGN файлов в папке: {len(files)}")

    game_count = 0
    for filename in files:
        filepath = os.path.join(folder_path, filename)
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            while True:
                try:
                    game = chess.pgn.read_game(f)
                    if game is None:
                        break
                    game_count += 1

                    board = game.board()
                    ply = 0
                    for move in game.mainline_moves():
                        if ply >= 12:
                            break

                        uci = move.uci()
                        if uci == "0000" or not bool(move):
                            break

                        parts = board.fen().split(" ")
                        fen_key = f"{parts[0]} {parts[1]} {parts[2]} -"

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
            weight = max(int((count / total_count) * 100), 1)
            comment = f"Любимый ход Лабурдонне в атаке (встречалось в партиях: {count} раз(а))."
            moves_list.append((uci, weight, comment))
        formatted_book[fen] = moves_list

    if formatted_book:
        with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as out_f:
            json.dump(formatted_book, out_f, ensure_ascii=False, indent=4)
        print(f"[+] Дебютная книга Лабурдонне сохранена в {OUTPUT_JSON_PATH}")

        if os.path.exists(bot_file_path):
            with open(bot_file_path, "r", encoding="utf-8") as f:
                content = f.read()

            new_book_str = (
                    "LABOURDONNAIS_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = "
                    + json.dumps(formatted_book, ensure_ascii=False, indent=4)
            )
            start_idx = content.find("LABOURDONNAIS_OPENING_BOOK")
            end_idx = content.find("CENTER_SQUARES =")
            if start_idx != -1 and end_idx != -1:
                new_content = content[:start_idx] + new_book_str + "\n\n" + content[end_idx:]
                with open(bot_file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"[+] Файл бота успешно обновлен: {bot_file_path}")

    return formatted_book


if __name__ == "__main__":
    import_folder_pgns(DEFAULT_FOLDER)
