# --- FILE: scripts/trace_logs.py ---
"""
Разбор журналов (src/core/logging_setup.py): показывает хронологию событий по одному признаку — игрок, партия, номер
запроса, турнир — чтобы воспроизвести жалобу «у меня пропала партия».

Откуда читает: файлы json-журнала (в разработке — logs/api.jsonl и logs/worker.jsonl, их пишет start_dev.ps1) или
стандартный ввод (`docker compose logs --no-log-prefix api worker | python scripts/trace_logs.py game_id=7`).
Строки не в формате json (чужие библиотеки, трассировки) пропускаются.

    python scripts/trace_logs.py game_id=20767 logs/api.jsonl logs/worker.jsonl
    python scripts/trace_logs.py request_id=8906cace68764324 logs/api.jsonl
    python scripts/trace_logs.py user_id=1 --level WARNING logs/api.jsonl

Цепочка по отчёту клиента: найти строку client_error, взять related_request_ids и разобрать каждый номер этой же командой.
"""

import argparse
import json
import sys
from collections.abc import Iterable, Iterator

LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
# Поля, которые не повторяются в хвосте строки: они уже в её начале.
_HEAD_FIELDS = {"ts", "level", "logger", "component", "msg"}


def parse_lines(lines: Iterable[str]) -> Iterator[dict]:
    """Json-записи из строк журнала; не-json пропускаются."""
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and "msg" in row:
            yield row


def matches(row: dict, wanted: dict[str, str], min_level: str = "DEBUG") -> bool:
    """Запись подходит, если все пары поле=значение совпадают (число и строка сравниваются как строки)
    и её уровень не ниже min_level. Значение в списке (related_request_ids) считается совпадением по вхождению."""
    if LEVELS.index(row.get("level", "INFO")) < LEVELS.index(min_level):
        return False
    for key, value in wanted.items():
        have = row.get(key)
        if isinstance(have, list):
            if value not in {str(item) for item in have}:
                return False
        elif str(have) != value:
            return False
    return True


def render(row: dict) -> str:
    """Одна строка хронологии: время, уровень, источник, сообщение и остальные поля."""
    tail = " ".join(f"{key}={value}" for key, value in row.items() if key not in _HEAD_FIELDS and key != "exc")
    source = f"{row.get('component', '?')}/{row.get('logger', '?')}"
    line = f"{row.get('ts', '?')} {row.get('level', '?'):<7} {source}: {row['msg']}"
    if tail:
        line += f"  {tail}"
    if row.get("exc"):
        line += "\n" + str(row["exc"])
    return line


def trace(lines: Iterable[str], wanted: dict[str, str], min_level: str = "DEBUG") -> list[str]:
    """Отфильтрованная и упорядоченная по времени хронология (строки уже отрисованы)."""
    rows = [row for row in parse_lines(lines) if matches(row, wanted, min_level)]
    rows.sort(key=lambda row: row.get("ts", ""))
    return [render(row) for row in rows]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Хронология событий из json-журнала Regence")
    parser.add_argument("filters", nargs="+", help="поле=значение, например game_id=7; дальше — файлы журнала")
    parser.add_argument("--level", default="DEBUG", choices=LEVELS, help="минимальный уровень")
    args = parser.parse_args(argv)
    wanted: dict[str, str] = {}
    files: list[str] = []
    for item in args.filters:
        if "=" in item:
            key, _, value = item.partition("=")
            wanted[key] = value
        else:
            files.append(item)
    if not wanted:
        parser.error("нужен хотя бы один фильтр поле=значение")
    if files:
        lines: list[str] = []
        for path in files:
            with open(path, encoding="utf-8") as handle:
                lines.extend(handle)
    else:
        lines = list(sys.stdin)
    out = trace(lines, wanted, args.level)
    print("\n".join(out) if out else "ничего не найдено")
    return 0 if out else 1


if __name__ == "__main__":
    sys.exit(main())
