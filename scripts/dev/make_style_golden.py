"""
Снимок стилевых бонусов исторических ботов для теста эквивалентности (tests/test_style_presets.py).

Позиции — детерминированные полуслучайные партии: дебют (где действует большинство правил стиля),
миттельшпиль и эндшпиль. Перегенерировать нужно только при намеренном изменении стиля бота.

    python scripts/dev/make_style_golden.py
"""

import json
import random
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.services.bots import BOT_INSTANCES  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "style_bonus_golden.json"
SAMPLE_PLIES = (0, 1, 2, 3, 5, 8, 12, 17, 23, 30, 40, 55)
# Позиции под правила, до которых случайные партии почти не доходят: рокировки обеих сторон
# (в т.ч. длинная), ладьи на центральных вертикалях, превращение пешки.
CURATED = (
    "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5",
    "r3kb1r/pp1qpppp/2np1n2/2p5/4P1b1/2NP1N2/PPPBBPPP/R2QK2R w KQkq - 4 7",
    "r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R b KQkq - 5 8",
    "rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 2 5",
    "2r2rk1/pp1q1ppp/2nbpn2/3p4/3P4/2NBPN2/PPQ2PPP/R4RK1 w - - 4 13",
    "8/5P2/8/3k4/8/8/2K5/8 w - - 0 50",
)


def sample_positions(games: int = 8, seed: int = 20261112) -> list[str]:
    rng = random.Random(seed)
    fens: list[str] = []
    for _ in range(games):
        board = chess.Board()
        for ply in range(max(SAMPLE_PLIES) + 1):
            if board.is_game_over():
                break
            if ply in SAMPLE_PLIES and board.fen() not in fens:
                fens.append(board.fen())
            moves = sorted(board.legal_moves, key=lambda m: m.uci())
            # Чаще берём взятия и шахи, чтобы в выборке были тактические правила стиля.
            sharp = [m for m in moves if board.is_capture(m) or board.gives_check(m)]
            board.push(rng.choice(sharp) if sharp and rng.random() < 0.4 else rng.choice(moves))
    return fens


def main() -> None:
    fens = list(CURATED) + [f for f in sample_positions() if f not in CURATED]
    notes: list[str | None] = [None]
    note_ids: dict[str | None, int] = {None: 0}
    data: dict = {"notes": notes, "positions": []}
    for fen in fens:
        board = chess.Board(fen)
        moves = sorted(board.legal_moves, key=lambda m: m.uci())
        entry: dict = {"fen": fen, "moves": [m.uci() for m in moves], "bots": {}}
        for bot_id, bot in BOT_INSTANCES.items():
            row = []
            for mv in moves:
                bonus, note = bot.evaluate_style_bonus(board, mv)
                if note not in note_ids:
                    note_ids[note] = len(notes)
                    notes.append(note)
                row.append([round(bonus, 6), note_ids[note]])
            entry["bots"][bot_id] = row
        data["positions"].append(entry)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = sum(len(p["moves"]) for p in data["positions"]) * len(BOT_INSTANCES)
    print(f"{len(fens)} позиций, {total} пар (бот, ход), {len(notes) - 1} комментариев -> {OUT}")


if __name__ == "__main__":
    main()
