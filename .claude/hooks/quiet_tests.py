"""Claude Code hook: keeps test output short so it does not flood the context.

Mode 1 (hook, no args): reads the Bash tool call JSON from stdin. If the
  command is a plain test run (pytest / vitest / npm test) it is rewritten to
  run through this script in mode 2. Any other command is left untouched.
Mode 2 (runner, arg = base64 command): runs the command and prints a short
  result. Pass: summary line only. Fail: output without progress lines,
  capped at MAX_LINES. The exit code is preserved.
"""
import base64
import json
import os
import re
import subprocess
import sys

MAX_LINES = 150
HEAD = 90
TAIL = 50

# Only plain test commands: no ; | > < ` $ and no second &&.
SAFE_REST = r"[^;&|<>`$\n]*"
TEST_CMD = re.compile(
    r"^\s*(cd frontend && )?"
    r"((python3? -m )?pytest|npx vitest run|npm (run )?test)"
    + SAFE_REST + r"$"
)
PROGRESS_LINE = re.compile(r"^[\s.sFExX%\[\]0-9]*$")


def hook_mode() -> None:
    try:
        data = json.load(sys.stdin)
        cmd = data.get("tool_input", {}).get("command", "")
    except Exception:
        print("{}")
        return
    if not TEST_CMD.match(cmd):
        print("{}")
        return
    encoded = base64.b64encode(cmd.encode("utf-8")).decode("ascii")
    script = os.path.abspath(__file__).replace("\\", "/")
    python = sys.executable.replace("\\", "/")
    new_cmd = f'"{python}" "{script}" {encoded}'
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "quiet test runner",
            "updatedInput": {"command": new_cmd},
        }
    }))


def runner_mode(encoded: str) -> int:
    cmd = base64.b64decode(encoded).decode("utf-8")
    proc = subprocess.run(
        cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    text = proc.stdout.decode("utf-8", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    useful = [ln for ln in lines if not PROGRESS_LINE.match(ln)]
    print(f"[quiet-tests] {cmd}")
    if proc.returncode == 0:
        print("\n".join(useful[-3:]))
        return 0
    if len(useful) > MAX_LINES:
        skipped = len(useful) - HEAD - TAIL
        useful = useful[:HEAD] + [f"... {skipped} lines skipped ..."] + useful[-TAIL:]
    print("\n".join(useful))
    print(f"[quiet-tests] exit code {proc.returncode}")
    return proc.returncode


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if len(sys.argv) > 1:
        sys.exit(runner_mode(sys.argv[1]))
    hook_mode()
