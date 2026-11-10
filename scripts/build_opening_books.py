# --- FILE: scripts/build_opening_books.py ---

import json
import shutil
import sys
from pathlib import Path

import chess
import chess.pgn

# Жёсткая привязка к корню проекта (независимо от Working Directory в PyCharm)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

BOOKS_DIR = PROJECT_ROOT / "src" / "services" / "bots" / "books"
MAX_BOOK_PLY = 16

BOT_BOOK_CONFIG = {
    "philidor": {
        "identifiers": ("philidor", "филидор"),
        "surname_filter": "philidor",
        "exclude": (),
        "comment_tpl": "Исторический выбор Филидора (встречалось в партиях: {count} раз(а)).",
    },
    "labourdonnais": {
        "identifiers": ("bourdonnais", "labourdonnais", "лабурдонне"),
        "surname_filter": "bourdonnais",
        "exclude": (),
        "comment_tpl": "Любимый ход Лабурдонне в атаке (встречалось в партиях: {count} раз(а)).",
    },
    "staunton": {
        "identifiers": ("staunton", "стаунтон"),
        "surname_filter": "staunton",
        "exclude": (),
        "comment_tpl": "Классический выбор Стаунтона (встречалось в партиях: {count} раз(а)).",
    },
    "anderssen": {
        "identifiers": ("anderssen", "андерсен"),
        "surname_filter": "anderssen",
        "exclude": (),
        "comment_tpl": "Бриллиантовый гамбит Андерсена (встречалось в партиях: {count} раз(а)).",
    },
    "morphy": {
        "identifiers": ("morphy", "морфи"),
        "surname_filter": "morphy",
        "exclude": ("alonzo", "ernest"),
        "comment_tpl": "Исторический ход Пола Морфи (встречалось в партиях: {count} раз(а)).",
    },
    "paulsen": {
        "identifiers": ("paulsen", "паульсен"),
        "surname_filter": "paulsen",
        "exclude": ("wilfried",),
        "comment_tpl": "Глубокая новинка Паульсена (встречалось в партиях: {count} раз(а)).",
    },
    "zukertort": {
        "identifiers": ("zukertort", "цукерторт"),
        "surname_filter": "zukertort",
        "exclude": (),
        "comment_tpl": "Универсальный дебютный выбор Цукерторта (встречалось в партиях: {count} раз(а)).",
    },
}


def cleanup_misplaced_artifacts() -> None:
    """
    Удаляет ошибочно созданную папку scripts/src (возникшую из-за запуска с CWD=scripts/)
    и переносит все *_generated_book.json из корня в src/services/bots/books/.
    """
    BOOKS_DIR.mkdir(parents=True, exist_ok=True)

    accidental_scripts_src = PROJECT_ROOT / "scripts" / "src"
    if accidental_scripts_src.exists():
        for stray_json in accidental_scripts_src.rglob("*.json"):
            target = BOOKS_DIR / stray_json.name
            if not target.exists():
                shutil.move(str(stray_json), str(target))
        shutil.rmtree(accidental_scripts_src, ignore_errors=True)
        print(f"[+] Очищена лишняя вложенная папка: {accidental_scripts_src}")

    for bot_id in BOT_BOOK_CONFIG:
        legacy_root_json = PROJECT_ROOT / f"{bot_id}_generated_book.json"
        target_json = BOOKS_DIR / f"{bot_id}.json"
        if legacy_root_json.exists():
            if not target_json.exists() or legacy_root_json.stat().st_size > target_json.stat().st_size:
                shutil.move(str(legacy_root_json), str(target_json))
                print(f"[+] Перенесена книга из корня: {legacy_root_json.name} -> {target_json}")
            else:
                legacy_root_json.unlink()


def matches_player(header_name: str, surname: str, exclude: tuple[str, ...]) -> bool:
    name_lower = (header_name or "").lower()
    if any(ex in name_lower for ex in exclude):
        return False
    return surname in name_lower


def process_pgn_stream(pgn_stream, surname: str, exclude: tuple[str, ...], book_additions: dict) -> int:
    games_processed = 0
    while True:
        try:
            game = chess.pgn.read_game(pgn_stream)
            if game is None:
                break

            is_w = matches_player(game.headers.get("White", ""), surname, exclude)
            is_b = matches_player(game.headers.get("Black", ""), surname, exclude)
            track_both = not (is_w or is_b)

            board = game.board()
            ply = 0
            for move in game.mainline_moves():
                if ply >= MAX_BOOK_PLY:
                    break
                uci = move.uci()
                if uci == "0000" or not bool(move):
                    break

                white_turn = board.turn == chess.WHITE
                if track_both or (white_turn and is_w) or (not white_turn and is_b):
                    parts = board.fen().split(" ")
                    fen_key = f"{parts[0]} {parts[1]} {parts[2]} -"
                    book_additions.setdefault(fen_key, {})
                    book_additions[fen_key][uci] = book_additions[fen_key].get(uci, 0) + 1

                try:
                    board.push(move)
                except ValueError:
                    break
                ply += 1  # noqa: SIM113 — считаем только успешно сыгранные ходы

            games_processed += 1
        except Exception:
            continue
    return games_processed


def find_pgn_files_for_bot(identifiers: tuple[str, ...]) -> list[Path]:
    """Ищет PGN-файлы чемпиона во всех возможных директориях проекта."""
    search_dirs = [
        PROJECT_ROOT / "data",
        PROJECT_ROOT / "downloaded_pgns",
        PROJECT_ROOT / "src" / "db" / "data",
        PROJECT_ROOT,
    ]
    found: list[Path] = []
    seen: set[Path] = set()

    for directory in search_dirs:
        if not directory.exists():
            continue
        iterator = directory.glob("*.pgn") if directory == PROJECT_ROOT else directory.rglob("*.pgn")
        for pgn_path in iterator:
            resolved = pgn_path.resolve()
            if resolved in seen or not resolved.is_file():
                continue
            path_lower = str(resolved).lower()
            if any(ident in path_lower for ident in identifiers):
                seen.add(resolved)
                found.append(resolved)

    # Если есть как объединённый файл (*_all_*.pgn), так и мелкие файлы из папки —
    # отдаём приоритет объединённому файлу, чтобы не считать одни и те же партии дважды
    combined = [p for p in found if "all" in p.name.lower() or "все партии" in p.name.lower()]
    if combined:
        return [max(combined, key=lambda p: p.stat().st_size)]
    return found


def build_book_for_bot(bot_id: str) -> None:
    cfg = BOT_BOOK_CONFIG[bot_id]
    target_json = BOOKS_DIR / f"{bot_id}.json"

    existing_book: dict = {}
    if target_json.exists():
        try:
            with open(target_json, encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    existing_book = loaded
        except Exception:
            existing_book = {}

    matched_files = find_pgn_files_for_bot(cfg["identifiers"])
    book_additions: dict[str, dict[str, int]] = {}
    total_games = 0

    for filepath in matched_files:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            total_games += process_pgn_stream(f, cfg["surname_filter"], cfg["exclude"], book_additions)

    if total_games > 0:
        formatted_book: dict[str, list] = dict(existing_book)
        for fen, moves_dict in book_additions.items():
            sorted_moves = sorted(moves_dict.items(), key=lambda x: x[1], reverse=True)
            total_count = sum(moves_dict.values())
            formatted_book[fen] = [
                [
                    uci,
                    max(int((count / total_count) * 100), 1),
                    cfg["comment_tpl"].format(count=count),
                ]
                for uci, count in sorted_moves
            ]

        with open(target_json, "w", encoding="utf-8") as out_f:
            json.dump(formatted_book, out_f, ensure_ascii=False, indent=2)
        print(
            f"[+] {bot_id:13s}: спарсено партий из PGN: {total_games:4d} | "
            f"Позиций в книге: {len(formatted_book):4d} -> {target_json.relative_to(PROJECT_ROOT)}"
        )
        return

    # Если сырых PGN-файлов нет, но JSON-книга уже перенесена и лежит в src/services/bots/books/
    if existing_book:
        print(
            f"[+] {bot_id:13s}: книга активна и проверена | "
            f"Позиций в книге: {len(existing_book):4d} -> {target_json.relative_to(PROJECT_ROOT)}"
        )
        return

    # Если нет ни PGN, ни JSON-книги — инициализируем JSON-файл базовым репертуаром из модуля бота
    try:
        module = __import__(f"src.services.bots.{bot_id}", fromlist=["*"])
        default_attr = f"DEFAULT_{bot_id.upper()}_BOOK"
        fallback_data = getattr(module, default_attr, {})
        if fallback_data:
            serializable = {
                fen: [[m[0], int(m[1]), str(m[2])] for m in moves]
                for fen, moves in fallback_data.items()
            }
            with open(target_json, "w", encoding="utf-8") as out_f:
                json.dump(serializable, out_f, ensure_ascii=False, indent=2)
            print(
                f"[~] {bot_id:13s}: создана базовая книга | "
                f"Позиций в книге: {len(serializable):4d} -> {target_json.relative_to(PROJECT_ROOT)}"
            )
            return
    except Exception as exc:
        print(f"[!] Ошибка инициализации базовой книги для {bot_id}: {exc}")


def main() -> None:
    print(f"=== Сборка и проверка дебютных книг (Корень: {PROJECT_ROOT}) ===")
    cleanup_misplaced_artifacts()
    for b_id in BOT_BOOK_CONFIG:
        build_book_for_bot(b_id)
    print("=== Все дебютные книги готовы! ===")


if __name__ == "__main__":
    main()
