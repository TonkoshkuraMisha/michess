# --- FILE: import_philidor.py ---

import json
import os
import chess.pgn


def parse_and_update_philidor_bot(pgn_file_path: str, bot_file_path: str = "src/services/bots/philidor.py"):
    """
    Парсит все партии Филидора из PGN (с учетом пользовательских FEN и меток),
    собирает статистику ходов и автоматически обновляет PHILIDOR_OPENING_BOOK в файле бота.
    """
    book_additions = {}

    if not os.path.exists(pgn_file_path):
        print(f"[-] PGN файл не найден: {pgn_file_path}")
        print(f"[*] Убедитесь, что файл с партиями лежит в корне проекта под именем: '{pgn_file_path}'")
        return

    print(f"[+] Чтение и парсинг файла: {pgn_file_path}...")
    with open(pgn_file_path, 'r', encoding='utf-8', errors='ignore') as f:
        game_count = 0
        while True:
            try:
                game = chess.pgn.read_game(f)
                if game is None:
                    break
                game_count += 1

                board = game.board()
                ply = 0
                # Берём первые 10 полуходов (5 полных ходов) из каждой исторической партии для дебютной книги
                for move in game.mainline_moves():
                    if ply >= 10:
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
                # Пропускаем поврежденные партии, не прерывая общий процесс
                continue

    print(f"[+] Успешно обработано партий из базы: {game_count}")
    print(f"[+] Найдено уникальных дебютных позиций: {len(book_additions)}")

    # Форматируем полученные данные в структуру для бот-файла
    formatted_book = {}
    for fen, moves_dict in book_additions.items():
        sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
        total_count = sum(moves_dict.values())

        moves_list = []
        for uci, count in sorted_moves:
            # Вычисляем вес (процент популярности хода в партиях маэстро)
            weight = int((count / total_count) * 100)
            comment = f"Исторический выбор Филидора (встречалось в партиях: {count} раз(а))."
            moves_list.append((uci, max(weight, 1), comment))
        formatted_book[fen] = moves_list

    # Сохраняем резервную копию в JSON
    output_json = "philidor_generated_book.json"
    with open(output_json, "w", encoding="utf-8") as out_f:
        json.dump(formatted_book, out_f, ensure_ascii=False, indent=4)
    print(f"[+] JSON-слепок книги сохранен: {output_json}")

    # Интегрируем книгу в src/services/bots/philidor.py
    if os.path.exists(bot_file_path):
        with open(bot_file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        new_book_str = "PHILIDOR_OPENING_BOOK: dict[str, list[tuple[str, int, str]]] = " + json.dumps(formatted_book,
                                                                                                      ensure_ascii=False,
                                                                                                      indent=4)

        start_idx = content.find("PHILIDOR_OPENING_BOOK")
        end_marker = "CENTER_SQUARES ="
        end_idx = content.find(end_marker)

        if start_idx != -1 and end_idx != -1:
            new_content = content[:start_idx] + new_book_str + "\n\n" + content[end_idx:]
            with open(bot_file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"[+] Файл бота успешно обновлен всеми партиями: {bot_file_path}")
        else:
            print("[-] Не удалось автоматически найти точки замены в файле бота philidor.py.")
    else:
        print(f"[-] Не найден файл бота по пути: {bot_file_path}")


if __name__ == "__main__":
    # Убедитесь, что ваш файл с партиями называется именно так или поправьте имя ниже
    pgn_filename = "Все партии Франсуа-Андре Филидора в формате pgn.pgn"
    parse_and_update_philidor_bot(pgn_filename)
