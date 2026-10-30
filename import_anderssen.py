# --- FILE: import_anderssen.py ---

import json
import os
import chess
import chess.pgn

DEFAULT_PGN_FILE = "adolf_anderssen_all_849_games.pgn"
OUTPUT_JSON_PATH = "anderssen_generated_book.json"
BOT_FILE_PATH = "src/services/bots/anderssen.py"
MAX_BOOK_PLY = 16


def is_anderssen_player(header_name: str) -> bool:
    return "anderssen" in (header_name or "").lower()


def format_book_to_python(book_data: dict[str, list[tuple[str, int, str]]]) -> str:
    lines = ["ANDERSSEN_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {"]
    for fen, moves in book_data.items():
        lines.append(f'    "{fen}": [')
        for uci, weight, comment in moves:
            safe_comment = comment.replace('"', '\\"')
            lines.append(f'        ("{uci}", {weight}, "{safe_comment}"),')
        lines.append("    ],")
    lines.append("}")
    return "\n".join(lines)


def parse_and_update_anderssen(pgn_file_path: str = DEFAULT_PGN_FILE, bot_file_path: str = BOT_FILE_PATH):
    book_additions: dict[str, dict[str, int]] = {}
    if not os.path.exists(pgn_file_path):
        print(f"[-] PGN файл не найден: {pgn_file_path}")
        return

    print(f"[+] Чтение партий Андерсена из {pgn_file_path}...")
    game_count = 0

    with open(pgn_file_path, "r", encoding="utf-8", errors="ignore") as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            game_count += 1

            white_name = game.headers.get("White", "")
            black_name = game.headers.get("Black", "")
            is_white = is_anderssen_player(white_name)
            is_black = is_anderssen_player(black_name)
            track_both = not (is_white or is_black)

            board = game.board()
            ply = 0
            for move in game.mainline_moves():
                if ply >= MAX_BOOK_PLY:
                    break
                uci = move.uci()
                if uci == "0000" or not bool(move):
                    break

                is_white_turn = board.turn == chess.WHITE
                if track_both or (is_white_turn and is_white) or (not is_white_turn and is_black):
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

    print(f"[+] Обработано партий: {game_count} | Уникальных позиций: {len(book_additions)}")

    formatted_book = {}
    for fen, moves_dict in book_additions.items():
        sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
        total_count = sum(moves_dict.values())
        moves_list = []
        for uci, count in sorted_moves:
            weight = max(int((count / total_count) * 100), 1)
            comment = f"Бриллиантовый гамбит Андерсена (в партиях: {count} раз(а))."
            moves_list.append((uci, weight, comment))
        formatted_book[fen] = moves_list

    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as out_f:
        json.dump(formatted_book, out_f, ensure_ascii=False, indent=4)

    if os.path.exists(bot_file_path):
        with open(bot_file_path, "r", encoding="utf-8") as f:
            content = f.read()

        new_book_code = format_book_to_python(formatted_book)
        start_idx = content.find("ANDERSSEN_OPENING_BOOK")
        end_idx = content.find("CENTER_SQUARES =")
        if start_idx != -1 and end_idx != -1:
            new_content = content[:start_idx] + new_book_code + "\n\n" + content[end_idx:]
            with open(bot_file_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"[+] Файл бота успешно обновлен: {bot_file_path}")


if __name__ == "__main__":
    parse_and_update_anderssen()
