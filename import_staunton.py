# --- FILE: import_staunton.py ---

import json
import os
from pathlib import Path
import chess
import chess.pgn

DEFAULT_PGN_FILE = "howard_staunton_all_620_games.pgn"
DEFAULT_PGN_DIR = "staunton_pgns"
OUTPUT_JSON_PATH = "staunton_generated_book.json"
BOT_FILE_PATH = "src/services/bots/staunton.py"
MAX_BOOK_PLY = 16


def is_staunton_player(header_name: str) -> bool:
    return "staunton" in (header_name or "").lower()


def process_pgn_stream(pgn_stream, book_additions: dict) -> int:
    games_processed = 0
    while True:
        try:
            game = chess.pgn.read_game(pgn_stream)
            if game is None:
                break

            white_name = game.headers.get("White", "")
            black_name = game.headers.get("Black", "")
            is_white = is_staunton_player(white_name)
            is_black = is_staunton_player(black_name)
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

            games_processed += 1
        except Exception:
            continue
    return games_processed


def format_book_to_python(book_data: dict[str, list[tuple[str, int, str]]]) -> str:
    lines = ["STAUNTON_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {"]
    for fen, moves in book_data.items():
        lines.append(f'    "{fen}": [')
        for uci, weight, comment in moves:
            safe_comment = comment.replace('"', '\\"')
            lines.append(f'        ("{uci}", {weight}, "{safe_comment}"),')
        lines.append("    ],")
    lines.append("}")
    return "\n".join(lines)


def parse_and_update_staunton(
        pgn_file_path: str = DEFAULT_PGN_FILE,
        pgn_dir_path: str = DEFAULT_PGN_DIR,
        bot_file_path: str = BOT_FILE_PATH,
):
    book_additions: dict[str, dict[str, int]] = {}
    game_count = 0

    if os.path.exists(pgn_file_path):
        print(f"[+] Чтение партий Стаунтона из {pgn_file_path}...")
        with open(pgn_file_path, "r", encoding="utf-8", errors="ignore") as f:
            game_count = process_pgn_stream(f, book_additions)
    elif os.path.exists(pgn_dir_path):
        pgn_files = sorted(Path(pgn_dir_path).glob("*.pgn"))
        print(f"[+] Чтение {len(pgn_files)} PGN-файлов из папки {pgn_dir_path}...")
        for filepath in pgn_files:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                game_count += process_pgn_stream(f, book_additions)
    elif os.path.exists(OUTPUT_JSON_PATH):
        print(f"[~] PGN не найден, используем уже существующий {OUTPUT_JSON_PATH}...")
        with open(OUTPUT_JSON_PATH, "r", encoding="utf-8") as f:
            formatted_book = json.load(f)
        _inject_into_bot_file(formatted_book, bot_file_path)
        return formatted_book
    else:
        print(f"[-] PGN-файлы не найдены: '{pgn_file_path}' или '{pgn_dir_path}'")
        return {}

    print(f"[+] Обработано партий Стаунтона: {game_count} | Уникальных позиций: {len(book_additions)}")

    formatted_book = {}
    for fen, moves_dict in book_additions.items():
        sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
        total_count = sum(moves_dict.values())
        moves_list = []
        for uci, count in sorted_moves:
            weight = max(int((count / total_count) * 100), 1)
            comment = f"Классический выбор Стаунтона (в партиях: {count} раз(а))."
            moves_list.append((uci, weight, comment))
        formatted_book[fen] = moves_list

    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as out_f:
        json.dump(formatted_book, out_f, ensure_ascii=False, indent=4)
    print(f"[+] JSON-слепок дебютной книги сохранен: {OUTPUT_JSON_PATH}")

    _inject_into_bot_file(formatted_book, bot_file_path)
    return formatted_book


def _inject_into_bot_file(formatted_book: dict, bot_file_path: str) -> None:
    if not os.path.exists(bot_file_path):
        return
    with open(bot_file_path, "r", encoding="utf-8") as f:
        content = f.read()

    new_book_code = format_book_to_python(formatted_book)
    start_idx = content.find("STAUNTON_OPENING_BOOK")
    end_marker = "# Маркер для корректной работы авто-обновления"
    if content.find(end_marker) == -1:
        end_marker = "BOOK_END_MARKER ="
    end_idx = content.find(end_marker)

    if start_idx != -1 and end_idx != -1:
        new_content = content[:start_idx] + new_book_code + "\n\n" + content[end_idx:]
        with open(bot_file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"[+] Файл бота успешно обновлен в красивом формате: {bot_file_path}")


if __name__ == "__main__":
    parse_and_update_staunton()
