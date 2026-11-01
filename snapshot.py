# --- FILE: snapshot.py ---

import json
import os
import re
from pathlib import Path

# Автоматически определяем корень проекта michess, даже если скрипт лежит в папке scripts/
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = _SCRIPT_DIR.parent if _SCRIPT_DIR.name.lower() == "scripts" else _SCRIPT_DIR

# Результат слепка всегда сохраняется строго в корне проекта
OUTPUT_FILE = PROJECT_ROOT / "project_snapshot.txt"

# Максимальный размер одного файла для полного вывода текста (256 КБ), чтобы слепок не зависал
MAX_FILE_SIZE_BYTES = 256 * 1024

EXCLUDE_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    ".pytest_cache",
    "michess_env",
    "venv",
    "env",
    "node_modules",
    "dist",
    "build",
    "bin",
    "data",
    "downloaded_pgns",
    "morphy_pgns",
    "staunton_pgns",
    "anderssen_pgns",
    "paulsen_pgns",
    "zukertort_pgns",
}

EXCLUDE_FILES = {
    "project_snapshot.txt",
    "project_snapshot_2.txt",
    "package-lock.json",
    "michess_local.db",
}

SKIP_CONTENT_SUFFIXES = (
    "_generated_book.json",
    ".pgn",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".svg",
    ".mp3",
    ".wav",
    ".ogg",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".sqlite3",
    ".db",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".pdf",
)

SECRET_KEY_PATTERN = re.compile(
    r"^(\s*(?:POSTGRES_\w+|SECRET_KEY|ALGORITHM|ACCESS_TOKEN_\w+|REDIS_\w+)\s*=\s*)(.+)$"
)


def _indent(level: int) -> str:
    return "".join(["    " for _ in range(level)])


def mask_env_content(content: str) -> str:
    masked_lines = []
    for line in content.splitlines():
        match = SECRET_KEY_PATTERN.match(line)
        if match:
            masked_lines.append(f"{match.group(1)}***[HIDDEN]***")
        else:
            masked_lines.append(line)
    return "\n".join(masked_lines)


def is_opening_book_json(filepath: Path) -> bool:
    parts = [p.lower() for p in filepath.parts]
    return filepath.suffix.lower() == ".json" and "books" in parts and "bots" in parts


def cleanup_stray_snapshots() -> None:
    """Удаляет дубликаты project_snapshot.txt из папки scripts/ и родительской директории."""
    stray_paths = [
        PROJECT_ROOT / "scripts" / "project_snapshot.txt",
        PROJECT_ROOT.parent / "project_snapshot.txt",
    ]
    for stray in stray_paths:
        if stray != OUTPUT_FILE and stray.exists():
            try:
                stray.unlink()
                print(f"[+] Удален лишний дубликат слепка: {stray}")
            except OSError:
                pass


def generate_snapshot(root_dir: Path = PROJECT_ROOT) -> None:
    cleanup_stray_snapshots()

    tree_lines = [
        "========================================",
        "        PROJECT DIRECTORY TREE",
        "========================================\n",
        f"{root_dir.name}/",
    ]
    files_to_dump: list[Path] = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = sorted([d for d in dirnames if d not in EXCLUDE_DIRS and not d.endswith("_pgns")])
        rel_dir = os.path.relpath(dirpath, root_dir)
        depth = 0 if rel_dir == "." else len(rel_dir.split(os.sep))

        if rel_dir != ".":
            tree_lines.append(f"{_indent(depth)}{os.path.basename(dirpath)}/")

        file_prefix = _indent(depth + 1)
        for filename in sorted(filenames):
            if filename.startswith("project_snapshot") and filename.endswith(".txt"):
                continue
            tree_lines.append(f"{file_prefix}{filename}")
            if filename not in EXCLUDE_FILES and not filename.endswith(SKIP_CONTENT_SUFFIXES):
                files_to_dump.append(Path(dirpath) / filename)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write("\n".join(tree_lines) + "\n\n\n")
        out.write("========================================\n")
        out.write("             FILE CONTENTS\n")
        out.write("========================================\n\n")

        for filepath in files_to_dump:
            rel_path = os.path.relpath(filepath, root_dir)
            out.write(f"\n--- FILE: {rel_path} ---\n\n")
            try:
                if is_opening_book_json(filepath):
                    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                        book_data = json.load(f)
                    count = len(book_data) if isinstance(book_data, dict) else 0
                    out.write(f"// [Дебютная книга JSON: {count} уникальных позиций FEN]\n")
                    continue

                file_size = filepath.stat().st_size
                if file_size > MAX_FILE_SIZE_BYTES:
                    size_kb = file_size / 1024
                    out.write(f"// [Файл пропущен из-за большого размера: {size_kb:.1f} KB]\n")
                    continue

                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                if filepath.name == ".env":
                    text = mask_env_content(text)
                out.write(text + "\n")
            except Exception as exc:
                out.write(f"[Ошибка чтения файла: {exc}]\n")

    print(f"[+] Слепок проекта успешно сохранен в {OUTPUT_FILE} (файлов записано: {len(files_to_dump)})")


if __name__ == "__main__":
    generate_snapshot()
