# --- FILE: scripts/dev/sweep_coach.py ---
"""
Проверка наставника на партиях архива (таск 11.2): полный разбор со Stockfish и комментарии к ходам —
напечатанные по-русски, чтобы их можно было прочитать глазами, и сводка: сколько ходов прокомментировано,
сколько ошибок объяснено конкретной причиной, а сколько только общей фразой.

Нужен Stockfish (bin/stockfish.exe или STOCKFISH_PATH). В CI не запускается.

    python -m scripts.dev.sweep_coach data/pgns/morphy_all_games.pgn --games 10 --depth 12
"""

import argparse
import collections
import io
import pathlib
import re
import sys

import chess.pgn

from src.services.analysis_service import _evaluate_board_sequence_sync

CATALOG = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n" / "messages" / "ru.ts"


def load_coach_texts() -> dict[str, str]:
    """Тексты coach.* из русского каталога: «coach.verdict.blunder.v1» → шаблон."""
    text = CATALOG.read_text(encoding="utf-8")
    block = text[text.index("    coach: {"):]
    texts: dict[str, str] = {}
    group = code = None
    for line in block.splitlines()[1:]:
        if m := re.match(r"^        (\w+): \{$", line):
            group = m.group(1)
        elif m := re.match(r"^            (\w+): \{$", line):
            code = m.group(1)
        elif m := re.match(r"^                (v\d): '(.*)',$", line):
            texts[f"coach.{group}.{code}.{m.group(1)}"] = m.group(2).replace("\\'", "'")
        elif line == "    },":
            break
    return texts


def render(sentences: list[dict], texts: dict[str, str]) -> str:
    return " ".join(texts[s["key"]].format(**s["params"]) for s in sentences)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pgn", type=pathlib.Path)
    parser.add_argument("--games", type=int, default=5)
    parser.add_argument("--depth", type=int, default=12)
    parser.add_argument("--quiet", action="store_true", help="только сводка")
    args = parser.parse_args()

    texts = load_coach_texts()
    stats: collections.Counter = collections.Counter()
    with open(args.pgn, encoding="utf-8", errors="replace") as handle:
        for _ in range(args.games):
            game = chess.pgn.read_game(handle)
            if game is None:
                break
            pgn = str(game)
            report = _evaluate_board_sequence_sync(pgn, args.depth)
            if not args.quiet:
                print(f"\n=== {game.headers.get('White')} — {game.headers.get('Black')} ({game.headers.get('Date')})")
            for move in report["moves"]:
                stats["moves"] += 1
                coach = move.get("coach")
                if move["classification"] in ("Inaccuracy", "Mistake", "Blunder"):
                    stats["bad"] += 1
                    keys = [s["key"] for s in (coach or {}).get("comment", [])]
                    if any(k.startswith("coach.threat.") or k.startswith("coach.missed.") for k in keys):
                        stats["bad_with_reason"] += 1
                    if any(k.split(".")[2] not in ("generic",) for k in keys if k.startswith("coach.best.")):
                        stats["bad_with_idea"] += 1
                if coach:
                    stats["commented"] += 1
                    for sentence in coach["comment"]:
                        stats[".".join(sentence["key"].split(".")[1:3])] += 1
                    if not args.quiet:
                        print(f"{move['move_number']}{'.' if move['color'] == 'white' else '...'} {move['san']}"
                              f" [{move['classification']}, {move['cp_loss']}]: {render(coach['comment'], texts)}")
    print("\n--- сводка")
    for key, value in sorted(stats.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"{key:28s} {value}")


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    main()
