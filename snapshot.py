# --- FILE: snapshot.py ---

import os
import re

OUTPUT_FILE = "project_snapshot.txt"

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
    "bin",
    "downloaded_pgns",
    "morphy_pgns",
    "staunton_pgns",
    "anderssen_pgns",
    "paulsen_pgns",
    "zukertort_pgns",
}

EXCLUDE_FILES = {
    OUTPUT_FILE,
    "package-lock.json",
    "michess_local.db",
}

# Исключаем сгенерированные гигантские JSON-книги из полного вывода содержимого,
# чтобы слепок проекта оставался компактным и не обрывался до папки src/
skip_content_suffixes = (
    "_generated_book.json",
    ".pgn",
    ".exe",
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
    ".mp3",
    ".woff",
    ".woff2",
    ".sqlite3",
    ".db",
)

SECRET_KEY_PATTERN = re.compile(
    r"^(\s*(?:POSTGRES_\w+|SECRET_KEY|ALGORITHM|ACCESS_TOKEN_\w+|REDIS_\w+)\s*=\s*)(.+)$"
)


def mask_env_content(content: str) -> str:
    masked_lines = []
    for line in content.splitlines():
        match = SECRET_KEY_PATTERN.match(line)
        if match:
            masked_lines.append(f"{match.group(1)}***[HIDDEN]***")
        else:
            masked_lines.append(line)
    return "\n".join(masked_lines)


def generate_snapshot(root_dir: str = ".") -> None:
    tree_lines = [
        "========================================",
        "        PROJECT DIRECTORY TREE",
        "========================================\n",
        "michess/",
    ]
    files_to_dump: list[str] = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = sorted([d for d in dirnames if d not in EXCLUDE_DIRS])
        rel_dir = os.path.relpath(dirpath, root_dir)
        depth = 0 if rel_dir == "." else len(rel_dir.split(os.sep))

        if rel_dir != ".":
            indent = "    " * depth
            tree_lines.append(f"{indent}{os.path.basename(dirpath)}/")

        file_indent = "    " * (depth + 1)
        for filename in sorted(filenames):
            if filename.startswith("project_snapshot") and filename.endswith(".txt"):
                continue
            tree_lines.append(f"{file_indent}{filename}")
            if filename not in EXCLUDE_FILES and not filename.endswith(skip_content_suffixes):
                files_to_dump.append(os.path.join(dirpath, filename))

    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write("\n".join(tree_lines) + "\n\n\n")
        out.write("========================================\n")
        out.write("             FILE CONTENTS\n")
        out.write("========================================\n\n")

        for filepath in files_to_dump:
            rel_path = os.path.relpath(filepath, root_dir)
            out.write(f"\n--- FILE: {rel_path} ---\n\n")
            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                if os.path.basename(filepath) == ".env":
                    text = mask_env_content(text)
                out.write(text + "\n")
            except Exception as exc:
                out.write(f"[Ошибка чтения файла: {exc}]\n")

    print(f"[+] Слепок проекта успешно сохранен в {OUTPUT_FILE} (файлов записано: {len(files_to_dump)})")


if __name__ == "__main__":
    generate_snapshot()
