# --- FILE: tests/test_trace_logs.py ---
"""Разбор журналов (scripts/trace_logs.py): фильтр по полям и уровню, хронология, пропуск не-json строк."""

import json

from scripts.trace_logs import main, matches, parse_lines, trace


def _row(ts: str, msg: str, **fields) -> str:
    level = fields.pop("level", "INFO")
    return json.dumps({"ts": ts, "level": level, "logger": "x", "component": "api", "msg": msg, **fields})


LINES = [
    _row("2026-11-21T13:00:03.000+00:00", "ws_action", game_id=7, user_id=1, action="make_move"),
    "Traceback (most recent call last): не json — пропускается",
    _row("2026-11-21T13:00:01.000+00:00", "http_request", request_id="req-abcdef01", user_id=1, status=200),
    _row("2026-11-21T13:00:05.000+00:00", "task_failed", level="ERROR", game_id=7, exc="ValueError: boom"),
    _row("2026-11-21T13:00:04.000+00:00", "client_error", level="ERROR", related_request_ids=["req-abcdef01"]),
    _row("2026-11-21T13:00:02.000+00:00", "ws_action", game_id=8),
]


def test_parse_skips_non_json_and_rows_without_msg():
    assert len(list(parse_lines(LINES + ["{not json", json.dumps({"a": 1})]))) == 5


def test_trace_by_game_is_chronological():
    out = trace(LINES, {"game_id": "7"})
    assert len(out) == 2 and out[0].index("ws_action") < len(out[0]) and "task_failed" in out[1]
    assert "13:00:03" in out[0] and "13:00:05" in out[1]
    assert "ValueError: boom" in out[1]  # стек ошибки печатается


def test_numbers_and_strings_compare_as_text_and_lists_match_by_membership():
    assert matches({"level": "INFO", "user_id": 1}, {"user_id": "1"})
    assert not matches({"level": "INFO", "user_id": 2}, {"user_id": "1"})
    assert matches({"level": "ERROR", "related_request_ids": ["a", "req-abcdef01"]}, {"related_request_ids": "req-abcdef01"})


def test_level_filter_and_client_report_chain():
    assert [line.split()[1] for line in trace(LINES, {"game_id": "7"}, "ERROR")] == ["ERROR"]
    assert len(trace(LINES, {"related_request_ids": "req-abcdef01"})) == 1
    assert len(trace(LINES, {"request_id": "req-abcdef01"})) == 1


def test_cli_reads_files_and_reports_nothing_found(tmp_path, capsys):
    log = tmp_path / "api.jsonl"
    log.write_text("\n".join(LINES), encoding="utf-8")
    assert main(["game_id=7", str(log)]) == 0
    assert "task_failed" in capsys.readouterr().out
    assert main(["game_id=999", str(log)]) == 1
    assert "ничего не найдено" in capsys.readouterr().out
