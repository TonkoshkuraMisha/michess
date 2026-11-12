# --- FILE: scripts/dev/sweep_motifs.py ---
"""
Прогон детектора мотивов наставника по партиям из PGN: частота каждого мотива, время на полуход и случайные
примеры для ручной проверки. Нужен при настройке правил: тесты проверяют подобранные позиции, а этот прогон —
как детектор ведёт себя в настоящих партиях (ложные срабатывания видны по примерам).

    python scripts/dev/sweep_motifs.py data/pgns/morphy_all_games.pgn 120 fork trapped skewer
"""

import collections
import random
import sys
import time
from pathlib import Path

import chess
import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.services.mentor_service import analyze_move  # noqa: E402


def main(path: str, games_limit: int, show: list[str]) -> None:
    random.seed(7)
    counts: collections.Counter[str] = collections.Counter()
    samples: dict[str, list[tuple[str, str, object]]] = collections.defaultdict(list)
    plies = 0
    started = time.perf_counter()
    with open(path, encoding="utf-8", errors="replace") as handle:
        for _ in range(games_limit):
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            board = game.board()
            for move in game.mainline_moves():
                if not board.is_valid() or move not in board.legal_moves:
                    break  # партии с форой и пропуском хода в архиве встречаются
                facts = analyze_move(board, move)
                san = board.san(move)
                for motif in facts.created:
                    counts[motif.code] += 1
                    if len(samples[motif.code]) < 40:
                        samples[motif.code].append((board.fen(), san, motif))
                board.push(move)
                plies += 1
    elapsed = time.perf_counter() - started
    print(f"полуходов: {plies}, время: {elapsed:.1f} с, на полуход: {elapsed / max(plies, 1) * 1000:.1f} мс")
    for code, count in counts.most_common():
        print(f"  {code:18} {count:6}  {count / max(plies, 1) * 100:5.1f} % полуходов")
    for code in show:
        print(f"\n=== {code} (позиция до хода | ход -> поле и цели)")
        for fen, san, motif in random.sample(samples[code], min(6, len(samples[code]))):
            targets = [chess.square_name(t) for t in motif.targets]  # type: ignore[attr-defined]
            print(f"  {fen} | {san} -> {chess.square_name(motif.square)} {targets} {motif.value}")  # type: ignore[attr-defined]


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3:])
