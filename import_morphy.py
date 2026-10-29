# --- FILE: import_morphy.py ---

import json
import os
from pathlib import Path
import chess
import chess.pgn

DEFAULT_PGN_FILE = "paul_morphy_all_457_games.pgn"
DEFAULT_PGN_DIR = "morphy_pgns"
OUTPUT_JSON_PATH = "morphy_generated_book.json"
BOT_FILE_PATH = "src/services/bots/morphy.py"
MAX_BOOK_PLY = 16  # Первые 8 полных ходов для дебютной книги Пола Морфи


def is_morphy_player(header_name: str) -> bool:
    """Проверяет, принадлежит ли имя игрока Полу Морфи (исключая его отца Алонсо и дядю Эрнеста)."""
    name_lower = (header_name or "").lower()
    if "alonzo" in name_lower or "ernest" in name_lower:
        return False
    return "morphy" in name_lower


def process_pgn_stream(pgn_stream, book_additions: dict) -> int:
    """Читает партии из потока и записывает дебютные ходы Пола Морфи."""
    games_processed = 0

    while True:
        try:
            game = chess.pgn.read_game(pgn_stream)
            if game is None:
                break

            white_name = game.headers.get("White", "")
            black_name = game.headers.get("Black", "")
            morphy_is_white = is_morphy_player(white_name)
            morphy_is_black = is_morphy_player(black_name)
            track_both = not (morphy_is_white or morphy_is_black)

            board = game.board()
            ply = 0

            for move in game.mainline_moves():
                if ply >= MAX_BOOK_PLY:
                    break

                uci = move.uci()
                if uci == "0000" or not bool(move):
                    break

                is_white_turn = board.turn == chess.WHITE
                should_record = (
                        track_both
                        or (is_white_turn and morphy_is_white)
                        or (not is_white_turn and morphy_is_black)
                )

                if should_record:
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


def format_opening_book_to_python_code(book_data: dict[str, list[tuple[str, int, str]]]) -> str:
    """Генерирует компактный и читаемый Python-код словаря дебютной книги в одну строку на каждый ход."""
    lines = ["MORPHY_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = {"]
    for fen, moves in book_data.items():
        lines.append(f'    "{fen}": [')
        for uci, weight, comment in moves:
            safe_comment = comment.replace('"', '\\"')
            lines.append(f'        ("{uci}", {weight}, "{safe_comment}"),')
        lines.append("    ],")
    lines.append("}")
    return "\n".join(lines)


def build_morphy_opening_book(
        pgn_file_path: str = DEFAULT_PGN_FILE,
        pgn_dir_path: str = DEFAULT_PGN_DIR,
        bot_file_path: str = BOT_FILE_PATH,
) -> dict[str, list[tuple[str, int, str]]]:
    book_additions: dict[str, dict[str, int]] = {}
    total_games = 0

    if os.path.exists(pgn_file_path):
        print(f"[+] Чтение объединённого PGN-файла: {pgn_file_path}...")
        with open(pgn_file_path, "r", encoding="utf-8", errors="ignore") as f:
            total_games = process_pgn_stream(f, book_additions)
    elif os.path.exists(pgn_dir_path):
        pgn_files = sorted(Path(pgn_dir_path).glob("*.pgn"))
        print(f"[+] Чтение {len(pgn_files)} PGN-файлов из папки {pgn_dir_path}...")
        for filepath in pgn_files:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                total_games += process_pgn_stream(f, book_additions)
    else:
        print(f"[-] PGN-файлы не найдены: '{pgn_file_path}' или '{pgn_dir_path}'")
        return {}

    print(f"[+] Успешно обработано партий Пола Морфи: {total_games}")
    print(f"[+] Найдено уникальных дебютных позиций: {len(book_additions)}")

    formatted_book: dict[str, list[tuple[str, int, str]]] = {}
    for fen, moves_dict in book_additions.items():
        sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
        total_count = sum(moves_dict.values())

        moves_list = []
        for uci, count in sorted_moves:
            weight = max(int((count / total_count) * 100), 1)
            comment = f"Исторический ход Пола Морфи (встречалось в партиях: {count} раз(а))."
            moves_list.append((uci, weight, comment))
        formatted_book[fen] = moves_list

    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as out_f:
        json.dump(formatted_book, out_f, ensure_ascii=False, indent=4)
    print(f"[+] JSON-слепок дебютной книги сохранен: {OUTPUT_JSON_PATH}")

    if os.path.exists(bot_file_path):
        with open(bot_file_path, "r", encoding="utf-8") as f:
            content = f.read()

        new_book_code = format_opening_book_to_python_code(formatted_book)

        start_idx = content.find("MORPHY_OPENING_BOOK")
        end_marker = "# Маркер для корректной работы авто-обновления"
        if content.find(end_marker) == -1:
            end_marker = "BOOK_END_MARKER ="
        end_idx = content.find(end_marker)

        if start_idx != -1 and end_idx != -1:
            new_content = content[:start_idx] + new_book_str + "\n\n" + content[
                end_idx:] if 'new_book_str' in locals() else content[:start_idx] + new_book_code + "\n\n" + content[
                end_idx:]
            # Используем корректно новую переменную new_book_code:
            new_content = content[:start_idx] + new_book_code + "\n\n" + content[end_idx:]
            with open(bot_file_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"[+] Файл бота успешно обновлен в красивом формате: {bot_file_path}")

    return formatted_book


if __name__ == "__main__":
    build_morphy_opening_book()
