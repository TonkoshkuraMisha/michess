# --- FILE: scripts/dev/review_disputes.py ---
"""
Разбор очереди «Не согласен» (таск 11.4): игроки оспаривают предупреждения наставника, позиции копятся в Redis
(`coach:disputes`, последние 2000). Скрипт перепроверяет каждую глубоким анализом и печатает, где наставник,
вероятно, ошибся: глубокая потеря заметно меньше той, по которой он предупредил (ложная тревога — порог или
недосчёт на малой глубине).

Нужны Redis (REDIS_URL, как у сервера) и Stockfish. В CI не запускается.

    python -m scripts.dev.review_disputes --depth 20 --limit 100
"""

import argparse
import asyncio
import json

import chess
import chess.engine

from src.db import redis as redis_module
from src.services.bots.base import resolve_stockfish_path
from src.services.move_check import DISPUTES_KEY, EVAL_CLAMP_CP, MATE_CP

FALSE_ALARM_RATIO = 0.5


def deep_loss(engine: chess.engine.SimpleEngine, fen: str, move_uci: str, depth: int) -> int:
    board = chess.Board(fen)
    sign = 1 if board.turn == chess.WHITE else -1

    def score(b: chess.Board) -> int:
        info = engine.analyse(b, chess.engine.Limit(depth=depth))
        cp = info["score"].white().score(mate_score=MATE_CP) or 0
        return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, cp))

    before = score(board)
    board.push_uci(move_uci)
    return max(0, sign * (before - score(board)))


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--depth", type=int, default=20)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    raw = await redis_module.redis_client.lrange(DISPUTES_KEY, 0, args.limit - 1)
    entries = [json.loads(item) for item in raw]
    if not entries:
        print("Очередь пуста.")
        return
    path = resolve_stockfish_path()
    if not path:
        raise SystemExit("Нужен Stockfish (bin/stockfish.exe или STOCKFISH_PATH).")
    engine = chess.engine.SimpleEngine.popen_uci(path)
    false_alarms = 0
    try:
        for entry in entries:
            loss = deep_loss(engine, entry["fen"], entry["move"], args.depth)
            claimed = entry.get("cp_loss")
            suspicious = claimed is not None and loss < claimed * FALSE_ALARM_RATIO
            false_alarms += suspicious
            mark = "ЛОЖНАЯ ТРЕВОГА?" if suspicious else "подтверждено"
            print(f"{mark:16} было {claimed} сп, глубоко {loss} сп  {entry['move']}  {entry['fen']}")
    finally:
        engine.quit()
    print(f"\nВсего {len(entries)}, похоже на ложную тревогу: {false_alarms}")


if __name__ == "__main__":
    asyncio.run(main())
