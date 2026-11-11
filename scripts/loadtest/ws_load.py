"""
Нагрузочный тест WebSocket: N одновременных PvP-партий через nginx, как у настоящих игроков.

    # 1. игроки и токены (внутри контейнера API, см. seed_users.py)
    docker compose -f docker-compose.prod.yml exec -T api \
        python -m scripts.loadtest.seed_users --count 400 > tokens.json
    # 2. нагрузка: 200 партий по 40 полуходов, «раздумье» 0,5–1,5 с на ход
    python scripts/loadtest/ws_load.py --base-url http://localhost:8080 --tokens tokens.json --games 200
    # 3. уборка
    docker compose -f docker-compose.prod.yml exec -T api python -m scripts.loadtest.seed_users --cleanup

Каждая пара: оба игрока берут одноразовый тикет (POST /auth/ws-ticket) и подключаются к
/api/v1/ws/matchmaking; первый создаёт приватный вызов, второй принимает его. Дальше игроки ходят
случайными легальными ходами; задержка хода — от отправки make_move до получения своего же
move_made (обработка на сервере, запись в Redis и БД, рассылка обоим игрокам). После заданного
числа полуходов белые сдаются — партия проходит весь путь до finish_game и пересчёта рейтинга.

Итог: подключения, партии, ходы, перцентили задержки и все ошибки по видам. Код выхода 1, если
p95 задержки хода выше --max-p95-ms или есть сбои — пригодно для CI.
"""

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field

import chess
import httpx
import websockets


@dataclass
class Stats:
    connected: int = 0
    games_started: int = 0
    games_finished: int = 0
    moves: int = 0
    move_latency_ms: list[float] = field(default_factory=list)
    errors: Counter = field(default_factory=Counter)


class Player:
    def __init__(self, info: dict, base_url: str, ws_url: str, stats: Stats):
        self.info = info
        self.base_url = base_url
        self.ws_url = ws_url
        self.stats = stats
        self.ws: websockets.ClientConnection | None = None
        self.inbox: asyncio.Queue[dict] = asyncio.Queue()
        self._reader: asyncio.Task | None = None

    async def connect(self, http: httpx.AsyncClient) -> None:
        res = await http.post(
            f"{self.base_url}/api/v1/auth/ws-ticket", headers={"Authorization": f"Bearer {self.info['token']}"},
        )
        res.raise_for_status()
        ticket = res.json()["ticket"]
        self.ws = await websockets.connect(
            f"{self.ws_url}/api/v1/ws/matchmaking?ticket={ticket}", open_timeout=20, max_size=2 ** 20,
        )
        self.stats.connected += 1
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                event = json.loads(raw)
                if event.get("event") == "error":
                    self.stats.errors[f"server: {event.get('code') or event.get('message')}"] += 1
                await self.inbox.put(event)
        except websockets.ConnectionClosed as exc:
            if exc.rcvd is None or exc.rcvd.code != 1000:
                self.stats.errors[f"closed: {exc.rcvd.code if exc.rcvd else 'no close frame'}"] += 1

    async def send(self, payload: dict) -> None:
        assert self.ws is not None
        await self.ws.send(json.dumps(payload))

    async def wait_for(self, predicate, within_s: float) -> dict:
        async with asyncio.timeout(within_s):
            while True:
                event = await self.inbox.get()
                if predicate(event):
                    return event

    async def close(self) -> None:
        if self.ws is not None:
            await self.ws.close()
        if self._reader is not None:
            await asyncio.gather(self._reader, return_exceptions=True)


async def play_pair(
        index: int, white_info: dict, black_info: dict, args: argparse.Namespace, stats: Stats,
        http: httpx.AsyncClient, connect_gate: asyncio.Semaphore,
) -> None:
    rng = random.Random(args.seed + index)
    creator = Player(white_info, args.base_url, args.ws_url, stats)
    acceptor = Player(black_info, args.base_url, args.ws_url, stats)
    stage = "connect"
    try:
        async with connect_gate:
            await creator.connect(http)
            await acceptor.connect(http)

        stage = "invite"
        await creator.send({"action": "create_invite", "base_time_ms": 600_000, "increment_ms": 0, "color_pref": "white"})
        invite = await creator.wait_for(lambda e: e.get("event") == "invite_created", args.timeout)
        await acceptor.send({"action": "accept_invite", "code": invite["code"]})
        start_w = await creator.wait_for(lambda e: e.get("event") == "match_found", args.timeout)
        await acceptor.wait_for(lambda e: e.get("event") == "match_found", args.timeout)
        stats.games_started += 1

        game_id = start_w["game_id"]
        by_color = {"white": creator, "black": acceptor}
        if start_w["color"] != "white":
            by_color = {"white": acceptor, "black": creator}
        board = chess.Board()
        version = int(start_w.get("state_version", 0))

        stage = "moves"
        for _ in range(args.moves):
            if board.is_game_over():
                break
            mover = by_color["white" if board.turn == chess.WHITE else "black"]
            await asyncio.sleep(rng.uniform(args.think_min, args.think_max))
            move = rng.choice(list(board.legal_moves))
            command_id = uuid.uuid4().hex
            sent = time.perf_counter()
            await mover.send({
                "action": "make_move", "game_id": game_id, "move": move.uci(),
                "command_id": command_id, "state_version": version, "time_taken_ms": 1000,
            })
            made = await mover.wait_for(
                lambda e, cid=command_id: (e.get("event") == "move_made" and e.get("command_id") == cid)
                or e.get("event") == "error",
                args.timeout,
            )
            if made.get("event") == "error":
                raise RuntimeError(f"move rejected: {made.get('message')}")
            stats.move_latency_ms.append((time.perf_counter() - sent) * 1000)
            stats.moves += 1
            board.push(move)
            version = int(made["state_version"])
            if made.get("game_over"):
                break

        stage = "finish"
        if not board.is_game_over():
            await by_color["white"].send({"action": "resign", "game_id": game_id})
        await by_color["black"].wait_for(lambda e: e.get("event") == "game_over", args.timeout)
        stats.games_finished += 1
    except TimeoutError:
        stats.errors[f"timeout: {stage}"] += 1
    except Exception as exc:
        stats.errors[f"{stage}: {type(exc).__name__}: {str(exc)[:80]}"] += 1
    finally:
        await creator.close()
        await acceptor.close()


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q / 100 * (len(ordered) - 1))))]


async def run(args: argparse.Namespace, players: list[dict]) -> int:
    if len(players) < 2 * args.games:
        print(f"need {2 * args.games} players in {args.tokens}, got {len(players)}", file=sys.stderr)
        return 2

    stats = Stats()
    connect_gate = asyncio.Semaphore(args.connect_concurrency)
    started = time.perf_counter()
    limits = httpx.Limits(max_connections=args.connect_concurrency * 2)
    async with httpx.AsyncClient(timeout=args.timeout, limits=limits) as http:
        await asyncio.gather(*[
            play_pair(i, players[2 * i], players[2 * i + 1], args, stats, http, connect_gate)
            for i in range(args.games)
        ])
    elapsed = time.perf_counter() - started

    lat = stats.move_latency_ms
    p95 = percentile(lat, 95)
    print(f"\n=== {args.games} concurrent games x {args.moves} plies via {args.base_url} ===")
    print(f"duration          {elapsed:.1f} s")
    print(f"ws connections    {stats.connected} / {4 * args.games // 2}")
    print(f"games             started {stats.games_started}, finished {stats.games_finished}")
    print(f"moves             {stats.moves} ({stats.moves / elapsed:.1f}/s)")
    if lat:
        print(
            "move latency ms   "
            f"p50 {percentile(lat, 50):.0f}  p95 {p95:.0f}  p99 {percentile(lat, 99):.0f}  "
            f"max {max(lat):.0f}  mean {statistics.fmean(lat):.0f}"
        )
    if stats.errors:
        print("errors:")
        for kind, count in stats.errors.most_common():
            print(f"  {count:5d}  {kind}")
    else:
        print("errors            none")

    failed = bool(stats.errors) or stats.games_finished < args.games or p95 > args.max_p95_ms
    return 1 if failed else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--ws-url", help="по умолчанию — base-url со схемой ws/wss")
    parser.add_argument("--tokens", required=True, help="JSON из seed_users.py")
    parser.add_argument("--games", type=int, default=50, help="одновременных партий")
    parser.add_argument("--moves", type=int, default=40, help="полуходов в каждой партии")
    parser.add_argument("--think-min", type=float, default=0.5, help="мин. пауза перед ходом, с")
    parser.add_argument("--think-max", type=float, default=1.5, help="макс. пауза перед ходом, с")
    parser.add_argument("--connect-concurrency", type=int, default=20, help="одновременных подключений при старте")
    parser.add_argument("--timeout", type=float, default=30.0, help="ожидание ответа сервера, с")
    parser.add_argument("--max-p95-ms", type=float, default=500.0, help="порог p95 задержки хода для кода выхода")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    args.ws_url = (args.ws_url or args.base_url.replace("https://", "wss://").replace("http://", "ws://")).rstrip("/")
    with open(args.tokens, encoding="utf-8") as fh:
        players = json.load(fh)
    sys.exit(asyncio.run(run(args, players)))


if __name__ == "__main__":
    main()
