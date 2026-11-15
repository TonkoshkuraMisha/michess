# --- FILE: tests/test_style_presets.py ---
"""
Исторические боты выражены декларативными пресетами общей модели стиля (src/services/bots/style.py).
Тест сверяет бонус и комментарий каждого бота для каждого легального хода с «золотым» снимком,
снятым с прежних отдельных функций evaluate_*_style_bonus (scripts/dev/make_style_golden.py):
92 позиции — дебют, рокировки обеих сторон, миттельшпиль, эндшпиль.
"""

import json
from pathlib import Path

import chess
import pytest

from src.services.bots import BOT_INSTANCES
from src.services.bots.masters import MASTER_BOTS

# Снимок снят с первой волны (7 ботов). Мастера второй волны (таск 21.5) — соперники с характером мастерской:
# их стиль задают ползунки, его проверяют тесты personality.
FIRST_WAVE = sorted(set(BOT_INSTANCES) - set(MASTER_BOTS))

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "style_bonus_golden.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("bot_id", FIRST_WAVE)
def test_preset_matches_previous_style_function(bot_id: str):
    bot = BOT_INSTANCES[bot_id]
    notes = GOLDEN["notes"]
    mismatches = []
    for position in GOLDEN["positions"]:
        board = chess.Board(position["fen"])
        for uci, (bonus, note_id) in zip(position["moves"], position["bots"][bot_id], strict=True):
            got_bonus, got_note = bot.evaluate_style_bonus(board, chess.Move.from_uci(uci))
            if round(got_bonus, 6) != bonus or got_note != notes[note_id]:
                mismatches.append((position["fen"], uci, (bonus, notes[note_id]), (got_bonus, got_note)))
    assert not mismatches, f"{len(mismatches)} расхождений, первые: {mismatches[:3]}"


def test_golden_covers_every_bot_and_many_moves():
    assert set(GOLDEN["positions"][0]["bots"]) == set(FIRST_WAVE)
    assert sum(len(p["moves"]) for p in GOLDEN["positions"]) > 2000
