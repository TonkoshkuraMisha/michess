#!/usr/bin/env python3
"""
Create an LLM-ready text snapshot of a project.

Run from the project root:
    python make_snapshot.py
    python make_snapshot.py --max-mb 5

The snapshot includes project source/config/docs, explicitly prioritizes
ToDo.md, requirements.txt and frontend files, and excludes virtualenvs,
dependencies, generated output, binary assets and common secrets.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

DEFAULT_MAX_MB = 5
OUTPUT_DIR_NAME = "_project_snapshot"

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
    OUTPUT_DIR_NAME,
}

EXCLUDED_FILES = {
    "package-lock.json", "npm-shrinkwrap.json",
    "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
    ".env", ".env.local", ".env.development", ".env.production",
    ".env.test", ".env.staging",
    "id_rsa", "id_ed25519", "known_hosts",
}

EXCLUDED_SUFFIXES = {
    ".pyc", ".pyo", ".pyd", ".so", ".dll", ".exe", ".bin",
    ".db", ".sqlite", ".sqlite3",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
    ".pdf", ".zip", ".7z", ".rar", ".tar", ".gz",
    ".mp3", ".mp4", ".mov", ".avi", ".wav",
    ".ttf", ".otf", ".woff", ".woff2",
    ".class", ".jar", ".war",
}

TEXT_SUFFIXES = {
    ".py", ".pyi",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".md", ".rst", ".txt",
    ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".java", ".go",
    ".rs", ".rb", ".php", ".swift", ".kt", ".kts",
    ".xml", ".xsd", ".graphql", ".gql", ".proto",
    ".vue", ".svelte", ".astro",
    ".tf", ".hcl", ".properties", ".conf",
}

TEXT_FILENAMES = {
    "Dockerfile", "Makefile", "Procfile", "Justfile",
    ".gitignore", ".dockerignore", ".editorconfig",
    ".prettierrc", ".eslintrc", ".npmrc",
}

SECRET_PATH_PARTS = {
    "secrets", "secret", "credentials", "private",
}

PRIORITY_FILES = [
    "ToDo.md",
    "requirements.txt",
    "pyproject.toml",
    "setup.cfg",
    "alembic.ini",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    "frontend/package.json",
    "frontend/vite.config.ts",
    "frontend/vite.config.js",
    "frontend/tsconfig.json",
]


def is_text_candidate(path: Path, relative: str) -> bool:
    name = path.name
    suffix = path.suffix.lower()
    rel_parts = {part.lower() for part in Path(relative).parts}

    if name in EXCLUDED_FILES:
        return False
    if suffix in EXCLUDED_SUFFIXES:
        return False
    if rel_parts & SECRET_PATH_PARTS:
        return False
    if re.search(r"(^|/)\.env(?:\.|$)", relative.replace("\\", "/"), re.I):
        return False

    if suffix in TEXT_SUFFIXES or name in TEXT_FILENAMES:
        return True

    # Include extensionless text configuration files, but not arbitrary binaries.
    if not suffix:
        try:
            sample = path.read_bytes()[:4096]
        except OSError:
            return False
        return b"\x00" not in sample

    return False


def collect_files(root: Path) -> tuple[list[Path], list[str]]:
    files: list[Path] = []
    unreadable: list[str] = []

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

    priority = {
        name.lower(): index
        for index, name in enumerate(PRIORITY_FILES)
    }

    def sort_key(path: Path):
        rel = path.relative_to(root).as_posix()
        lower = rel.lower()
        priority_index = priority.get(lower, len(priority))
        # Keep the project roadmap/manifests first, then group by folder.
        return (priority_index, lower)

    return sorted(files, key=sort_key), unreadable


def decode_file(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def make_file_blocks(root: Path, files: list[Path]) -> tuple[list[str], list[str]]:
    blocks: list[str] = []
    unreadable: list[str] = []

    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            content = decode_file(path)
        except OSError as exc:
            unreadable.append(f"{relative}: {exc}")
            continue

        content = content.replace("\r\n", "\n").replace("\r", "\n")
        block = (
            f"\n{'=' * 88}\n"
            f"FILE: {relative}\n"
            f"{'=' * 88}\n"
            f"{content.rstrip()}\n"
        )
        blocks.append(block)

    return blocks, unreadable


def split_oversized_block(block: str, max_bytes: int) -> list[str]:
    """Split one very large file block without losing or reordering characters."""
    if len(block.encode("utf-8")) <= max_bytes:
        return [block]

    pieces: list[str] = []
    remaining = block

    while remaining:
        low, high = 1, len(remaining)
        best = 1

        # Find the largest prefix that fits by UTF-8 byte size.
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

        pieces.append(remaining[:best])
        remaining = remaining[best:]

    return pieces


def pack_parts(blocks: list[str], max_bytes: int) -> list[str]:
    """Pack sequential file blocks into parts, staying below the byte limit."""
    chunks: list[str] = []
    for block in blocks:
        chunks.extend(split_oversized_block(block, max_bytes))

    parts: list[str] = []
    current: list[str] = []
    current_size = 0

    for chunk in chunks:
        chunk_size = len(chunk.encode("utf-8"))
        if current and current_size + chunk_size > max_bytes:
            parts.append("".join(current))
            current = []
            current_size = 0
        current.append(chunk)
        current_size += chunk_size

    if current:
        parts.append("".join(current))

    return parts or ["[Подходящих текстовых файлов не найдено]\n"]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Создать Snapshot проекта для передачи ИИ."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Корень проекта; по умолчанию текущая папка.",
    )
    parser.add_argument(
        "--max-mb",
        type=float,
        default=DEFAULT_MAX_MB,
        help=f"Максимальный размер части в MiB (по умолчанию {DEFAULT_MAX_MB}).",
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
    if args.max_mb <= 0:
        print("Ошибка: --max-mb должен быть больше нуля.", file=sys.stderr)
        return 2

    output = (
        args.output.expanduser().resolve()
        if args.output
        else root / OUTPUT_DIR_NAME
    )
    max_bytes = int(args.max_mb * 1024 * 1024 * 0.95)

    files, _ = collect_files(root)
    blocks, unreadable = make_file_blocks(root, files)
    parts = pack_parts(blocks, max_bytes)

    output.mkdir(parents=True, exist_ok=True)

    # Remove old numbered snapshots only; leave unrelated files untouched.
    for old in output.glob("snapshot_[0-9][0-9][0-9].txt"):
        old.unlink()

    index_lines = [
        f"PROJECT: {root.name}",
        f"ROOT: {root}",
        f"FILES INCLUDED: {len(blocks)}",
        f"PARTS: {len(parts)}",
        "",
        "UPLOAD ALL PARTS IN NUMERICAL ORDER.",
        "Each source file is marked with a FILE: relative/path header.",
        "If a very large file spans parts, its text continues in the next part.",
        "",
        "Included priority files are placed first when present:",
        *[f"  - {name}" for name in PRIORITY_FILES],
        "",
    ]
    (output / "README.txt").write_text(
        "\n".join(index_lines), encoding="utf-8"
    )

    print(f"Проект: {root}")
    print(f"Текстовых файлов включено: {len(blocks)}")
    print(f"Частей: {len(parts)}")
    print("")

    total_size = 0
    for number, content in enumerate(parts, start=1):
        header = (
            f"PROJECT SNAPSHOT — PART {number}/{len(parts)}\n"
            f"Project: {root.name}\n"
            "Read every part in numerical order.\n"
            + "-" * 88 + "\n"
        )
        destination = output / f"snapshot_{number:03d}.txt"
        destination.write_text(header + content, encoding="utf-8", newline="\n")
        size = destination.stat().st_size
        total_size += size
        print(f"{destination.name}: {size / 1024 / 1024:.2f} MiB")

    if unreadable:
        report = output / "unreadable_files.txt"
        report.write_text("\n".join(unreadable), encoding="utf-8")
        print(f"\nНе удалось прочитать файлов: {len(unreadable)}")
        print(f"Список: {report}")

    print(f"\nГотово. Результат: {output}")
    print(f"Общий размер частей: {total_size / 1024 / 1024:.2f} MiB")
    print(
        "\nПеред загрузкой проверь Snapshot на секреты: "
        "API-ключи, токены, пароли, приватные URL и персональные данные."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
