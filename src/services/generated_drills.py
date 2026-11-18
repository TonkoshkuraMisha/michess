# --- FILE: src/services/generated_drills.py ---
"""
Упражнения-генераторы (таск 13.7): выдача, проверка ответа, забег на минуту и личные рекорды.

Позиция не хранится: упражнение — ключ «вид.фигура.уровень.seed», сервер восстанавливает его генератором
(src/services/drill_generator.py) и проверяет ответ. Seed берутся из таблицы data/drills/seeds.json — заранее
подобранных позиций с единственным ответом. Мат в 2 — два хода: после первого верного сервер отвечает самым упорным
ходом соперника, затем засчитывается любой мат.

Забег на время (RUN_SECONDS, три ошибки — конец) хранится на сервере: счёт растёт только за упражнение, выданное в
этом забеге; лучший счёт по сочетанию «вид.фигура.уровень» — личный рекорд (таблица drill_records). Идущий забег —
запись Redis drills:run:{user_id}: сочетание, время конца, счёт, ошибки и ключ выданного упражнения; у игрока один
забег, новый заменяет прежний.
"""

import json
import pathlib
import random
import time

import chess
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db import redis as redis_module
from src.models.puzzle import DrillRecord
from src.models.user import User
from src.services import drill_generator as gen
from src.services.puzzles import PuzzleError

# Таблица проверенных seed: «вид.фигура.уровень» → список seed (собирает scripts/dev/build_drill_seeds.py).
SEEDS_FILE = pathlib.Path(__file__).resolve().parents[2] / "data" / "drills" / "seeds.json"
# Забег на время: длительность в секундах и число ошибок, после которого он заканчивается.
RUN_SECONDS = 60
RUN_MISTAKES = 3
# Запас на задержку сети: ответ, пришедший в эти секунды после конца забега, ещё засчитывается.
RUN_GRACE_S = 2
# Связь с путём по приёмам (13.4): тема → вид упражнения (кнопка в карточке темы).
THEME_DRILLS = {"hanging_piece": "capture", "fork": "fork", "pin": "pin", "basic_mates": "mate1"}

_seeds: dict[str, list[int]] | None = None


def seeds() -> dict[str, list[int]]:
    """Таблица seed из SEEDS_FILE; читается с диска один раз на процесс."""
    global _seeds
    if _seeds is None:
        _seeds = json.loads(SEEDS_FILE.read_text(encoding="utf-8"))
    return _seeds


def combo(kind: str, piece: str, level: int) -> str:
    """Ключ сочетания «вид.фигура.уровень» (ключ таблицы seed и рекорда); неизвестное сочетание — unknown_drill."""
    if not gen.supported(kind, piece) or level not in gen.LEVELS:
        raise PuzzleError("unknown_drill", 400, drill=f"{kind}/{piece}/{level}")
    return f"{kind}.{piece}.{level}"


def _color(fen: str) -> str:
    return "white" if fen.split()[1] == "w" else "black"


def view(drill: gen.Drill) -> dict:
    """Упражнение для клиента: позиция, чей ход, какой фигурой решать и сколько ходов в решении. Ответ не отдаётся."""
    board = chess.Board(drill.fen)
    moved = board.piece_at(chess.parse_square(drill.solutions[0][:2]))
    return {
        "key": drill.key, "kind": drill.kind, "piece": drill.piece, "level": drill.level,
        "fen": drill.fen, "color": _color(drill.fen),
        # Какой фигурой решать (для «случайной» — станет известно по задаче); в «уйти от мата» — любой.
        "piece_type": None if drill.kind == "escape" or moved is None else moved.symbol().lower(),
        "moves": 2 if drill.kind == "mate2" else 1,
    }


def pick(kind: str, piece: str, level: int, rng: random.Random | None = None) -> gen.Drill:
    """
    Случайное упражнение сочетания: seed из таблицы в случайном порядке, первый, по которому генератор строит
    позицию. Для сочетания нет ни одного годного seed — no_puzzles_available.
    """
    table = seeds().get(combo(kind, piece, level)) or []
    for seed in (rng or random).sample(table, len(table)):
        drill = gen.build(kind, piece, level, seed)
        if drill is not None:  # таблица собрана той же версией генератора — неудача означает его изменение
            return drill
    raise PuzzleError("no_puzzles_available", 404)


def _restore(key: str) -> gen.Drill:
    try:
        return gen.restore(key)
    except ValueError:
        raise PuzzleError("unknown_drill", 400, drill=key) from None


def _legal(board: chess.Board, uci: str) -> chess.Move:
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise PuzzleError("illegal_move", 400, move=uci) from None
    if move not in board.legal_moves:
        raise PuzzleError("illegal_move", 400, move=uci)
    return move


def full_line(drill: gen.Drill) -> list[str]:
    """Решение целиком: один ход, а в мате в 2 — первый ход, упорный ответ и мат."""
    if drill.kind != "mate2":
        return list(drill.solutions)
    board = chess.Board(drill.fen)
    first = chess.Move.from_uci(drill.solutions[0])
    reply = gen.mate_reply(board, first)
    board.push(first)
    board.push(reply)
    mate = min(m.uci() for m in board.legal_moves if _mates(board, m))
    return [first.uci(), reply.uci(), mate]


def _mates(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    mate = board.is_checkmate()
    board.pop()
    return mate


def check(key: str, moves: list[str]) -> dict:
    """
    Ответ на упражнение: moves — ходы решающего и ответы соперника по порядку (в мате в 2 — сначала один ход,
    затем все три). Возвращает, верно ли, закончено ли, ответ соперника (мат в 2) и решение при ошибке. Неверное
    число ходов или не тот ответ соперника во втором запросе — drill_wrong_step; нелегальный ход — illegal_move.
    Вторым ходом мата в 2 засчитывается любой матующий ход.
    """
    drill = _restore(key)
    if not moves or len(moves) > 3 or (drill.kind != "mate2" and len(moves) != 1) or len(moves) == 2:
        raise PuzzleError("drill_wrong_step", 409, step=len(moves))
    board = chess.Board(drill.fen)
    first = _legal(board, moves[0])
    if first.uci() not in drill.solutions:
        return {"correct": False, "done": True, "reply": None, "solution": full_line(drill)}
    if drill.kind != "mate2":
        return {"correct": True, "done": True, "reply": None, "solution": None}
    reply = gen.mate_reply(board, first)
    if len(moves) == 1:
        return {"correct": True, "done": False, "reply": reply.uci(), "solution": None}
    if moves[1] != reply.uci():
        raise PuzzleError("drill_wrong_step", 409, step=2)
    board.push(first)
    board.push(reply)
    final = _legal(board, moves[2])
    if _mates(board, final):
        return {"correct": True, "done": True, "reply": None, "solution": None}
    return {"correct": False, "done": True, "reply": None, "solution": full_line(drill)}


# --- забег на время ------------------------------------------------------------------------------------------

def _run_key(user_id: int) -> str:
    return f"drills:run:{user_id}"


async def _load_run(user_id: int) -> dict | None:
    raw = await redis_module.redis_client.get(_run_key(user_id))
    return json.loads(raw) if raw else None


async def _save_run(user_id: int, run: dict) -> None:
    """Сохраняет забег в Redis; запись живёт на 10 минут дольше забега, чтобы итог можно было забрать (finish_run)."""
    await redis_module.redis_client.set(_run_key(user_id), json.dumps(run), ex=RUN_SECONDS + 600)


def _run_over(run: dict) -> bool:
    """Забег окончен: набрано RUN_MISTAKES ошибок или вышло время (с запасом RUN_GRACE_S)."""
    return run["mistakes"] >= RUN_MISTAKES or time.time() > run["ends_at"] + RUN_GRACE_S


def run_view(run: dict) -> dict:
    return {"combo": run["combo"], "solved": run["solved"], "mistakes": run["mistakes"],
            "seconds_left": max(0, round(run["ends_at"] - time.time())), "over": _run_over(run)}


async def start_run(user: User, kind: str, piece: str, level: int) -> dict:
    """Начинает забег на время по сочетанию; прежний забег игрока, если он был, заменяется."""
    run = {"combo": combo(kind, piece, level), "ends_at": time.time() + RUN_SECONDS,
           "solved": 0, "mistakes": 0, "current": None}
    await _save_run(user.id, run)
    return run_view(run)


async def next_in_run(user: User) -> tuple[gen.Drill, dict]:
    """Следующее упражнение забега на время. Забега нет или он закончился — отказ."""
    run = await _load_run(user.id)
    if run is None:
        raise PuzzleError("timed_run_not_active", 409)
    if _run_over(run):
        raise PuzzleError("timed_run_over", 409)
    kind, piece, level = run["combo"].split(".")
    drill = pick(kind, piece, int(level))
    run["current"] = drill.key
    await _save_run(user.id, run)
    return drill, run_view(run)


async def answer(user: User, key: str, moves: list[str], *, in_run: bool) -> dict:
    """
    Проверка ответа; в забеге законченное упражнение (то, что выдано забегом) меняет счёт. Ответ на упражнение,
    которое забег не выдавал, — отказ timed_run_not_active; ответ после конца забега проверяется, но счёт не меняет.
    """
    result = check(key, moves)
    result["run"] = None
    if in_run:
        run = await _load_run(user.id)
        if run is None or run.get("current") != key:
            raise PuzzleError("timed_run_not_active", 409)
        if result["done"] and not _run_over(run):
            run["solved" if result["correct"] else "mistakes"] += 1
            run["current"] = None
            await _save_run(user.id, run)
        result["run"] = run_view(run)
    return result


async def finish_run(db: AsyncSession, user: User) -> dict:
    """Конец забега: счёт, ошибки и личный рекорд по сочетанию «вид.фигура.уровень» (обновляется, если побит)."""
    run = await _load_run(user.id)
    if run is None:
        raise PuzzleError("timed_run_not_active", 409)
    await redis_module.redis_client.delete(_run_key(user.id))
    record = await db.get(DrillRecord, (user.id, run["combo"]))
    best = record.best if record else 0
    new_record = run["solved"] > best
    if new_record:
        if record is None:
            db.add(DrillRecord(user_id=user.id, combo=run["combo"], best=run["solved"]))
        else:
            record.best = run["solved"]
        await db.commit()
    return {"combo": run["combo"], "score": run["solved"], "mistakes": run["mistakes"],
            "best": max(best, run["solved"]), "new_record": new_record}


async def records(db: AsyncSession, user: User) -> dict[str, int]:
    """Личные рекорды игрока: сочетание «вид.фигура.уровень» → лучший счёт забега (таблица drill_records)."""
    rows = await db.execute(select(DrillRecord.combo, DrillRecord.best).where(DrillRecord.user_id == user.id))
    return {combo_key: best for combo_key, best in rows}
