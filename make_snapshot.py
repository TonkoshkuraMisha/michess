#!/usr/bin/env python3
# --- FILE: make_snapshot.py ---
"""
Create an LLM-ready multi-part text snapshot of the project.

Run from the project root:
    python make_snapshot.py
    python make_snapshot.py --max-kb 80

Each part is capped at 80 KiB by default so chat attachments are never
truncated by upload limits.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

DEFAULT_MAX_KB = 80
OUTPUT_DIR_NAME = "_project_snapshot"
MAX_DATA_JSON_BYTES = 15 * 1024  # Сворачивать большие JSON-словари (например, книги дебютов > 15 КБ)

EXCLUDED_DIRS = {
    ".git", ".hg", ".svn",
    ".idea", ".vscode",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".tox", ".nox",
    ".venv", "venv", "env", "michess_env",
    "node_modules", "bower_components",
    "dist", "build", "target", "coverage", "htmlcov",
    ".next", ".nuxt", ".cache",
    "site-packages", "vendor",
    "bin", "downloaded_pgns", "data",
    OUTPUT_DIR_NAME,
}

EXCLUDED_FILES = {
    "package-lock.json", "npm-shrinkwrap.json",
    "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
    ".env", ".env.local", ".env.development", ".env.production",
    ".env.test", ".env.staging",
    "id_rsa", "id_ed25519", "known_hosts",
    "unreadable_files.txt",
}

EXCLUDED_SUFFIXES = {
    ".pyc", ".pyo", ".pyd", ".so", ".dll", ".exe", ".bin",
    ".db", ".sqlite", ".sqlite3",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".pdf", ".zip", ".7z", ".rar", ".tar", ".gz",
    ".mp3", ".mp4", ".mov", ".avi", ".wav",
    ".ttf", ".otf", ".woff", ".woff2",
    ".class", ".jar", ".war", ".pgn",
}

TEXT_SUFFIXES = {
    ".py", ".pyi",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".md", ".rst", ".txt",
    ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
    ".Mako", ".mako",
}

TEXT_FILENAMES = {
    "Dockerfile", "Makefile", "Procfile", "Justfile",
    ".gitignore", ".dockerignore", ".editorconfig",
    ".prettierrc", ".eslintrc", ".npmrc", "README",
}

SECRET_PATH_PARTS = {
    "secrets", "secret", "credentials", "private",
}

PRIORITY_FILES = [
    "ToDo.md",
    "requirements.txt",
    "pytest.ini",
    "alembic.ini",
    "docker-compose.yml",
    ".github/workflows/ci.yml",
    "frontend/package.json",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
]


def is_text_candidate(path: Path, relative: str) -> bool:
    name = path.name
    name_lower = name.lower()
    suffix = path.suffix.lower()
    rel_parts = {part.lower() for part in Path(relative).parts}

    if name in EXCLUDED_FILES:
        return False
    # Исключаем любые старые текстовые снэпшоты, чтобы они не попадали внутрь новых частей
    if "snapshot" in name_lower and suffix == ".txt":
        return False
    if name_lower.endswith("_generated_book.json"):
        return False
    if suffix in EXCLUDED_SUFFIXES:
        return False
    if rel_parts & SECRET_PATH_PARTS:
        return False
    if re.search(r"(^|/)\.env(?:\.|$)", relative.replace("\\", "/"), re.I):
        return False

    if suffix in TEXT_SUFFIXES or name in TEXT_FILENAMES:
        return True

    if not suffix:
        try:
            sample = path.read_bytes()[:4096]
        except OSError:
            return False
        return b"\x00" not in sample

    return False


def get_group_priority(relative_posix: str) -> tuple[int, str]:
    """
    Упорядочивает файлы по смысловым блокам:
    0..N — приоритетные манифесты (ToDo.md, requirements.txt и т.д.)
    100  — миграции БД (migrations/)
    200  — исходный код бэкенда (src/)
    300  — тесты бэкенда (tests/)
    400  — скрипты (scripts/)
    500  — исходный код фронтенда (frontend/)
    600  — остальные файлы
    """
    lower = relative_posix.lower()
    for idx, prio_name in enumerate(PRIORITY_FILES):
        if lower == prio_name.lower():
            return (idx, lower)

    if lower.startswith("migrations/"):
        return (100, lower)
    if lower.startswith("src/"):
        return (200, lower)
    if lower.startswith("tests/"):
        return (300, lower)
    if lower.startswith("scripts/"):
        return (400, lower)
    if lower.startswith("frontend/"):
        return (500, lower)
    return (600, lower)


def collect_files(root: Path) -> list[Path]:
    files: list[Path] = []

    for current, dirs, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        dirs[:] = sorted(
            d for d in dirs
            if d not in EXCLUDED_DIRS
            and not (current_path / d).is_symlink()
        )

        for filename in filenames:
            path = current_path / filename
            if path.is_symlink() or not path.is_file():
                continue

            relative = path.relative_to(root).as_posix()
            if is_text_candidate(path, relative):
                files.append(path)

    return sorted(files, key=lambda p: get_group_priority(p.relative_to(root).as_posix()))


def decode_file(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def maybe_summarize_large_json(path: Path, relative: str, content: str, full_json: bool) -> str:
    """
    Если это большая JSON-книга дебютов (> 15 КБ), сворачивает её до первых 3 позиций
    и общей сводки, чтобы не забивать контекст тысячами строк FEN.
    """
    if full_json or path.suffix.lower() != ".json":
        return content

    raw_size = len(content.encode("utf-8"))
    if raw_size <= MAX_DATA_JSON_BYTES:
        return content

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            total_keys = len(parsed)
            sample_items = list(parsed.items())[:3]
            sample_dict = dict(sample_items)
            sample_str = json.dumps(sample_dict, ensure_ascii=False, indent=2)
            return (
                f"// [AUTO-SUMMARY: Большой JSON-файл ({raw_size // 1024} KiB, {total_keys} ключей). "
                f"Показаны первые 3 записи. Для полного вывода запустите с --full-json]\n"
                f"{sample_str}\n"
                f"// ... ещё {max(0, total_keys - 3)} записей скрыто ..."
            )
    except Exception:
        pass

    return content


def make_file_blocks(
        root: Path,
        files: list[Path],
        full_json: bool = False,
) -> tuple[list[tuple[str, str]], list[str]]:
    blocks: list[tuple[str, str]] = []
    unreadable: list[str] = []

    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            content = decode_file(path)
        except OSError as exc:
            unreadable.append(f"{relative}: {exc}")
            continue

        content = content.replace("\r\n", "\n").replace("\r", "\n")
        content = maybe_summarize_large_json(path, relative, content, full_json)

        sep = "=" * 88
        block = (
            f"\n{sep}\n"
            f"FILE: {relative}\n"
            f"{sep}\n"
            f"{content.rstrip()}\n"
        )
        blocks.append((relative, block))

    return blocks, unreadable


def split_oversized_block(relative: str, block: str, max_bytes: int) -> list[tuple[str, str]]:
    """Делит один очень крупный файл по границам строк, если он сам превышает лимит части."""
    if len(block.encode("utf-8")) <= max_bytes:
        return [(relative, block)]

    pieces: list[tuple[str, str]] = []
    remaining = block
    part_idx = 1

    while remaining:
        low, high = 1, len(remaining)
        best = 1

        while low <= high:
            middle = (low + high) // 2
            size = len(remaining[:middle].encode("utf-8"))
            if size <= max_bytes:
                best = middle
                low = middle + 1
            else:
                high = middle - 1

        if best < len(remaining):
            newline = remaining.rfind("\n", 0, best)
            if newline > best // 2:
                best = newline + 1

        chunk_text = remaining[:best]
        label = f"{relative} (chunk {part_idx})"
        pieces.append((label, chunk_text))
        remaining = remaining[best:]
        part_idx += 1

    return pieces


def pack_parts(
        blocks: list[tuple[str, str]],
        max_bytes: int,
) -> list[tuple[list[str], str]]:
    """Упаковывает блоки файлов в части так, чтобы каждая часть была строго <= max_bytes."""
    chunks: list[tuple[str, str]] = []
    for relative, block in blocks:
        chunks.extend(split_oversized_block(relative, block, max_bytes))

    parts: list[tuple[list[str], str]] = []
    current_files: list[str] = []
    current_texts: list[str] = []
    current_size = 0

    for label, chunk in chunks:
        chunk_size = len(chunk.encode("utf-8"))
        if current_texts and current_size + chunk_size > max_bytes:
            parts.append((current_files, "".join(current_texts)))
            current_files = []
            current_texts = []
            current_size = 0

        current_files.append(label)
        current_texts.append(chunk)
        current_size += chunk_size

    if current_texts:
        parts.append((current_files, "".join(current_texts)))

    return parts or [([], "[Подходящих текстовых файлов не найдено]\n")]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Создать многочастный Snapshot проекта без обрезки в чате."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Корень проекта (по умолчанию текущая папка).",
    )
    parser.add_argument(
        "--max-kb",
        type=float,
        default=DEFAULT_MAX_KB,
        help=f"Максимальный размер одной части в KiB (по умолчанию {DEFAULT_MAX_KB} KiB).",
    )
    parser.add_argument(
        "--max-mb",
        type=float,
        default=None,
        help="Альтернативный лимит в MiB (переопределяет --max-kb, если указан).",
    )
    parser.add_argument(
        "--full-json",
        action="store_true",
        help="Не сворачивать большие JSON-книги дебютов.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=f"Папка результата (по умолчанию ./{OUTPUT_DIR_NAME}).",
    )
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    if not root.is_dir():
        print(f"Ошибка: папка не найдена: {root}", file=sys.stderr)
        return 2

    if args.max_mb is not None:
        max_kb = args.max_mb * 1024.0
    else:
        max_kb = args.max_kb

    if max_kb <= 10:
        print("Ошибка: размер части должен быть больше 10 KiB.", file=sys.stderr)
        return 2

    output = (
        args.output.expanduser().resolve()
        if args.output
        else root / OUTPUT_DIR_NAME
    )
    # Оставляем запас 3 KiB под шапку и футер части
    max_bytes = max(8192, int(max_kb * 1024) - 3072)

    files = collect_files(root)
    blocks, unreadable = make_file_blocks(root, files, full_json=args.full_json)
    parts = pack_parts(blocks, max_bytes)

    output.mkdir(parents=True, exist_ok=True)

    for old in output.glob("snapshot_[0-9][0-9][0-9].txt"):
        old.unlink()

    total_parts = len(parts)
    index_lines = [
        f"PROJECT: {root.name}",
        f"ROOT: {root}",
        f"FILES INCLUDED: {len(blocks)}",
        f"PARTS: {total_parts} (target <= {max_kb:.0f} KiB per part)",
        "",
        "UPLOAD ALL PARTS IN NUMERICAL ORDER (snapshot_001.txt .. snapshot_00N.txt).",
        "",
        "TABLE OF CONTENTS BY PART:",
    ]

    print(f"Проект: {root}")
    print(f"Текстовых файлов включено: {len(blocks)}")
    print(f"Количество частей: {total_parts} (лимит ~{max_kb:.0f} KiB на файл)\n")

    total_size = 0
    dash_line = "-" * 88
    for number, (part_files, content) in enumerate(parts, start=1):
        filename = f"snapshot_{number:03d}.txt"
        header = (
            f"PROJECT SNAPSHOT — PART {number}/{total_parts}\n"
            f"Project: {root.name}\n"
            f"Files in this part ({len(part_files)}): {', '.join(part_files)}\n"
            f"{dash_line}\n"
        )
        footer = (
            f"\n{dash_line}\n"
            f"END OF PART {number}/{total_parts}\n"
        )
        destination = output / filename
        destination.write_text(header + content + footer, encoding="utf-8", newline="\n")
        size = destination.stat().st_size
        total_size += size

        print(f"  [{number:02d}/{total_parts:02d}] {filename}: {size / 1024:.1f} KiB ({len(part_files)} файлов)")
        index_lines.append(f"\n--- {filename} ({size / 1024:.1f} KiB) ---")
        for pf in part_files:
            index_lines.append(f"  - {pf}")

    (output / "README.txt").write_text("\n".join(index_lines) + "\n", encoding="utf-8")

    if unreadable:
        report = output / "unreadable_files.txt"
        report.write_text("\n".join(unreadable), encoding="utf-8")
        print(f"\nНе удалось прочитать файлов: {len(unreadable)} (см. {report})")

    print(f"\nГотово! Папка со снэпшотом: {output}")
    print(f"Суммарный объём всех частей: {total_size / 1024:.1f} KiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
