# --- FILE: src/services/defense_drills.py ---
"""
Защитные упражнения (таск 13.6) — раздел I каталога тем: «Что грозит соперник?» (find_the_threat) и «Не зевни»
(blunder_check). «Единственная защита» (defensive_move) — обычные задачи базы с тегом lichess, их выдаёт тренировка
по приёмам (13.4).

Откуда позиции. Задача lichess — это ход-ошибка проигравшей стороны (moves[0]) и тактика победителя (moves[1]).
Из неё получаются два упражнения «за обороняющегося»:

* «Что грозит соперник?» — позиция после ошибки, но очередь хода — у ошибившегося (пустой ход соперника): тактика
  соперника становится угрозой. Сначала игрок показывает угрозу (фигуру, которая бьёт, или поле удара), затем
  защищается. Верная защита — любой ход, который движок оценивает почти как лучшую (``GOOD_MARGIN``).
* «Не зевни» — позиция до ошибки и три естественных хода: сыгранный человеком зевок, ещё один проигрывающий ход,
  который «на глаз» выглядит хорошо (высокая оценка мелкого поиска), и единственный безопасный. У проигрывающих
  ходов хранится опровержение — ответ соперника.

Критерии решаемости (``threat_drill`` / ``blunder_drill``, затем независимо ``verify_drill``) проверяются движком
при сборке выборки офлайн
(scripts/dev/build_defense_drills.py → data/puzzles/defense_drills.csv.gz); сервер движок для упражнений не
запускает. Прогресс — по темам find_the_threat / blunder_check, ступень упражнения — по рейтингу исходной задачи.
"""

import csv
import gzip
import json
import pathlib
import random
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass

import chess
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainValueError
from src.db import redis as redis_module
from src.models.puzzle import DefenseDrill, ThemeProgress
from src.models.user import User
from src.services.puzzles import PuzzleError, reset_stage_counts, update_theme_progress

DRILLS_FILE = pathlib.Path(__file__).resolve().parents[2] / "data" / "puzzles" / "defense_drills.csv.gz"
FIELDS = ("Kind", "SourceId", "FEN", "Threat", "Choices", "Refutations", "Good", "Rating", "Stage", "Motifs")
SOURCE = "lichess"

KINDS = ("threat", "blunder")
KIND_THEMES = {"threat": "find_the_threat", "blunder": "blunder_check"}
THEME_KINDS = {theme: kind for kind, theme in KIND_THEMES.items()}

# Критерии отбора (сантипешки с точки зрения обороняющегося).
DEFENSIBLE = -150        # лучшая защита не проигрывает: позиция держится
THREAT_GAIN = 300        # «ничего не делать» теряет хотя бы столько против лучшей защиты — угроза настоящая
THREAT_BEST_MARGIN = 50  # тактика задачи — лучший ход соперника (или почти)
GOOD_MARGIN = 80         # защита засчитывается, если она почти так же хороша, как лучшая
MAX_GOOD = 4             # защит немного: случайный ход угрозу не отражает
BLUNDER_LOSS = 300       # проигрывающий вариант в «Не зевни» теряет хотя бы столько против лучшего
LOSING = -200            # …и действительно проигрывает: «хуже лучшего, но всё ещё +3» — не зевок
NATURAL_GAP = 300        # «естественный» ход: на мелком поиске не хуже лучшего больше чем на столько
NATURAL_CANDIDATES = 6   # сколько самых естественных ходов проверять глубоко как ловушку
VERIFY_MARGIN = 200      # перепроверка: верный ход лучше неверных (и «ничего не делать») хотя бы на столько
MATE = 10_000

SESSION_TTL_S = 2 * 60 * 60
RECENT_KEPT = 200

# Лучшие ходы позиции: uci → (оценка с точки зрения ходящего, ответ соперника из главного варианта).
MoveScores = dict[str, tuple[int, str | None]]
# analyse(позиция, сколько лучших ходов, только среди этих ходов или все) — движок при сборке, таблица в тестах.
Analyse = Callable[[chess.Board, int, list[str] | None], MoveScores]


# --- сборка упражнений из задачи -----------------------------------------------------------------------------

def defender_position(fen: str, moves: list[str]) -> chess.Board | None:
    """
    Позиция «Что грозит соперник?»: после ошибки moves[0] — снова ход ошибившегося (пустой ход соперника).
    None, если так нельзя: ошибка дала шах или пустой ход оставляет короля под шахом.
    """
    board = chess.Board(fen)
    board.push_uci(moves[0])
    if board.is_check():
        return None
    board.push(chess.Move.null())
    if board.is_check() or not board.is_valid() or board.legal_moves.count() < 2:
        return None
    return chess.Board(board.fen())  # без истории: пустой ход не должен попадать в стек позиции


def threat_drill(fen: str, moves: list[str], analyse: Analyse) -> dict | None:
    """Упражнение «Что грозит соперник?» или None, если позиция не проходит критерии решаемости."""
    defender = defender_position(fen, moves)
    if defender is None:
        return None
    attacker = chess.Board(fen)
    attacker.push_uci(moves[0])
    threat = moves[1]
    attack = analyse(attacker, 1, None)
    if not attack:
        return None
    threat_score = attack[threat][0] if threat in attack else analyse(attacker, 1, [threat]).get(threat, (None,))[0]
    if threat_score is None or threat_score < max(s for s, _ in attack.values()) - THREAT_BEST_MARGIN:
        return None
    passing = -threat_score  # если обороняющийся «ничего не делает», соперник проводит тактику
    # Лучших защит смотрим на одну больше допустимого: если и она «хорошая» — защит слишком много.
    defense = analyse(defender, MAX_GOOD + 1, None)
    if not defense:
        return None
    best = max(s for s, _ in defense.values())
    if best < DEFENSIBLE or best - passing < THREAT_GAIN:
        return None
    good = sorted(uci for uci, (s, _) in defense.items() if s >= best - GOOD_MARGIN)
    if not 1 <= len(good) <= MAX_GOOD or len(good) * 3 > defender.legal_moves.count():
        return None
    return {"fen": defender.fen(), "threat": threat, "good": good}


def blunder_drill(fen: str, moves: list[str], analyse: Analyse, shallow: Analyse, seed: str) -> dict | None:
    """
    Упражнение «Не зевни»: зевок из партии, ещё один естественный проигрывающий ход и единственный безопасный.
    None, если позиция не проходит критерии (уже проиграна, зевок не проигрывает, нет естественной ловушки).
    Естественность — оценка мелкого поиска (``shallow``): ход, который «на глаз» не хуже лучшего.
    """
    board = chess.Board(fen)
    blunder = moves[0]
    top = analyse(board, 1, None)
    if not top:
        return None
    safe = next(iter(top))
    best = top[safe][0]
    if safe == blunder or best < DEFENSIBLE:
        return None
    looks = shallow(board, board.legal_moves.count(), None)
    if not looks:
        return None
    top_look = max(s for s, _ in looks.values())
    natural = sorted((uci for uci, (s, _) in looks.items()
                      if uci not in (safe, blunder) and s >= top_look - NATURAL_GAP),
                     key=lambda uci: (-looks[uci][0], uci))[:NATURAL_CANDIDATES]
    if not natural:
        return None
    scores = analyse(board, len(natural) + 1, [blunder, *natural])
    if blunder not in scores or scores[blunder][0] > min(best - BLUNDER_LOSS, LOSING):
        return None
    traps = [uci for uci in natural if uci in scores and scores[uci][0] <= min(best - BLUNDER_LOSS, LOSING)]
    if not traps:
        return None
    trap = traps[0]  # самый естественный из проигрывающих
    refutations = {uci: scores[uci][1] for uci in (blunder, trap)}
    if not all(refutations.values()):
        return None
    choices = [safe, blunder, trap]
    random.Random(seed).shuffle(choices)
    return {"fen": board.fen(), "choices": choices, "good": [safe], "refutations": refutations}


def verify_drill(row: dict, score_after: Callable[[str, str], int], *, margin: int = VERIFY_MARGIN,
                 losing: int = LOSING) -> bool:
    """
    Независимая перепроверка упражнения (глубже и с чистой памятью движка, чем при отборе): в эндшпилях и позициях с
    цугцвангом оценка мелкого поиска нестабильна, и «безопасный» ход может оказаться хуже «проигрывающего».
    ``score_after(fen, uci)`` — оценка после хода с точки зрения стороны, которая ходит в fen. В «Не зевни» неверные
    ходы должны проигрывать на самом деле (не выше ``losing``), а не только уступать безопасному. Тесты на другой
    версии движка передают мягкие ``margin`` / ``losing``: пограничные оценки у версий расходятся.
    """
    good = row["Good"].split()
    if row["Kind"] == "blunder":
        safe = score_after(row["FEN"], good[0])
        wrong = set(row["Choices"].split()) - set(good)
        return safe >= DEFENSIBLE and all(score_after(row["FEN"], uci) <= min(safe - margin, losing)
                                          for uci in wrong)
    defenses = [score_after(row["FEN"], uci) for uci in good]
    if min(defenses) < DEFENSIBLE:
        return False
    passing = chess.Board(row["FEN"])
    passing.push(chess.Move.null())
    threat = -score_after(passing.fen(), row["Threat"])  # оценка соперника → с точки зрения обороняющегося
    return threat <= min(defenses) - margin


# --- выборка и загрузка в базу -------------------------------------------------------------------------------

def read_drills(path: pathlib.Path = DRILLS_FILE) -> Iterator[dict]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as source:
        yield from csv.DictReader(source)


def write_drills(rows: Iterable[dict], path: pathlib.Path = DRILLS_FILE) -> int:
    count = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def validate_drill_row(row: dict) -> bool:
    """Позиция корректна, ходы легальны, у «Не зевни» ровно один верный из трёх, у угрозы она легальна для соперника."""
    try:
        board = chess.Board(row["FEN"])
        if not board.is_valid() or row["Kind"] not in KINDS:
            return False
        legal = {m.uci() for m in board.legal_moves}
        good = row["Good"].split()
        if not good or not set(good) <= legal:
            return False
        if row["Kind"] == "threat":
            opponent = board.copy(stack=False)
            opponent.push(chess.Move.null())
            return chess.Move.from_uci(row["Threat"]) in opponent.legal_moves
        choices = row["Choices"].split()
        refutations = dict(pair.split(":") for pair in row["Refutations"].split())
        return (len(choices) == 3 and set(choices) <= legal and len(set(choices) & set(good)) == 1
                and set(refutations) == set(choices) - set(good))
    except (ValueError, KeyError):
        return False


def _drill_fields(row: dict) -> dict:
    return {
        "fen": row["FEN"], "threat": row["Threat"] or None, "choices": row["Choices"],
        "refutations": row["Refutations"], "good_moves": row["Good"], "rating": int(row["Rating"]),
        "stage": int(row["Stage"]), "motifs": row["Motifs"],
    }


async def import_drills(db: AsyncSession, rows: Iterable[dict], *, prune: bool = True) -> dict[str, int]:
    """
    Синхронизирует упражнения с выборкой: новые добавляются, изменившиеся (пересобранная выборка) обновляются, а те,
    которых в выборке больше нет (отбракованы перепроверкой), удаляются — иначе забракованное упражнение осталось бы
    на сервере навсегда. Некорректные строки пропускаются. ``prune=False`` — только добавить и обновить.
    """
    existing = {(d.kind, d.source_id): d for d in (await db.execute(select(DefenseDrill))).scalars()}
    seen: set[tuple[str, str]] = set()
    report = {"added": 0, "updated": 0, "removed": 0, "invalid": 0}
    for row in rows:
        if not validate_drill_row(row):
            report["invalid"] += 1
            continue
        key = (row["Kind"], row["SourceId"])
        if key in seen:
            continue
        seen.add(key)
        fields = _drill_fields(row)
        drill = existing.get(key)
        if drill is None:
            db.add(DefenseDrill(kind=row["Kind"], source=SOURCE, source_id=row["SourceId"], **fields))
            report["added"] += 1
        elif any(getattr(drill, name) != value for name, value in fields.items()):
            for name, value in fields.items():
                setattr(drill, name, value)
            report["updated"] += 1
    if prune:
        for key, drill in existing.items():
            if key not in seen:
                await db.delete(drill)
                report["removed"] += 1
    await db.commit()
    reset_stage_counts()
    return report


async def stage_counts(db: AsyncSession) -> dict[tuple[str, int], int]:
    """Сколько упражнений у каждой темы раздела I на каждой ступени — для обзора тренировки."""
    rows = await db.execute(select(DefenseDrill.kind, DefenseDrill.stage, func.count())
                            .group_by(DefenseDrill.kind, DefenseDrill.stage))
    return {(KIND_THEMES[kind], stage): count for kind, stage, count in rows}


# --- решение -------------------------------------------------------------------------------------------------

@dataclass
class DrillSession:
    drill_id: int
    phase: str             # threat — показать угрозу; move — защититься (или выбрать ход в «Не зевни»)
    clean: bool = True     # без ошибки на первом этапе


def _session_key(user_id: int) -> str:
    return f"defense:session:{user_id}"


def _recent_key(user_id: int) -> str:
    return f"defense:recent:{user_id}"


async def _load_session(user_id: int) -> DrillSession | None:
    raw = await redis_module.redis_client.get(_session_key(user_id))
    return DrillSession(**json.loads(raw)) if raw else None


async def _save_session(user_id: int, session: DrillSession) -> None:
    await redis_module.redis_client.set(_session_key(user_id), json.dumps(asdict(session)), ex=SESSION_TTL_S)


def defender_color(drill: DefenseDrill) -> str:
    return "white" if drill.fen.split()[1] == "w" else "black"


def public_view(drill: DefenseDrill) -> dict:
    """Что видит игрок: позиция, его цвет, ступень; у «Не зевни» — три хода. Ни угрозы, ни верных ответов."""
    return {
        "id": drill.id,
        "kind": drill.kind,
        "theme": KIND_THEMES[drill.kind],
        "fen": drill.fen,
        "color": defender_color(drill),
        "rating": drill.rating,
        "stage": drill.stage,
        "choices": drill.choices.split() if drill.kind == "blunder" else [],
    }


async def _current_stage(db: AsyncSession, user_id: int, kind: str) -> int:
    progress = await db.get(ThemeProgress, (user_id, KIND_THEMES[kind]))
    return min(progress.stage, 4) if progress else 1


async def pick(db: AsyncSession, user: User, kind: str) -> DefenseDrill:
    """Упражнение вида kind на ступени игрока, без недавних; не хватает — с другой ступени или повтор."""
    if kind not in KINDS:
        raise PuzzleError("unknown_drill_kind", 400, kind=kind)
    stage = await _current_stage(db, user.id, kind)
    recent = [int(x) for x in await redis_module.redis_client.lrange(_recent_key(user.id), 0, -1)]
    attempts = ((True, True), (True, False), (False, False))  # (своя ступень, исключать недавние)
    for own_stage, exclude in attempts:
        query = select(DefenseDrill).where(DefenseDrill.kind == kind)
        if own_stage:
            query = query.where(DefenseDrill.stage == stage)
        if exclude and recent:
            query = query.where(DefenseDrill.id.not_in(recent))
        drill = await db.scalar(query.order_by(func.random()).limit(1))
        if drill is not None:
            break
    else:
        raise PuzzleError("no_puzzles_available", 404)
    await _save_session(user.id, DrillSession(drill.id, "threat" if kind == "threat" else "move"))
    await redis_module.redis_client.lpush(_recent_key(user.id), str(drill.id))
    await redis_module.redis_client.ltrim(_recent_key(user.id), 0, RECENT_KEPT - 1)
    return drill


async def _active(db: AsyncSession, user: User, drill_id: int, phase: str) -> tuple[DrillSession, DefenseDrill]:
    session = await _load_session(user.id)
    if session is None or session.drill_id != drill_id:
        raise PuzzleError("drill_not_active", 409, drill_id=drill_id)
    if session.phase != phase:
        raise PuzzleError("drill_wrong_step", 409, step=session.phase)
    drill = await db.get(DefenseDrill, drill_id)
    if drill is None:
        await redis_module.redis_client.delete(_session_key(user.id))
        raise PuzzleError("drill_not_active", 409, drill_id=drill_id)
    return session, drill


def _square(name: str) -> str:
    try:
        return chess.square_name(chess.parse_square(name))
    except ValueError:
        raise PuzzleError("invalid_square", 400, square=name) from None


async def show_threat(db: AsyncSession, user: User, drill_id: int, square: str) -> dict:
    """Первый этап «Что грозит соперник?»: верно — фигура, которая бьёт, или поле удара. Угроза раскрывается всегда."""
    session, drill = await _active(db, user, drill_id, "threat")
    threat = drill.threat or ""
    correct = _square(square) in (threat[:2], threat[2:4])
    session.phase, session.clean = "move", correct
    await _save_session(user.id, session)
    return {"correct": correct, "threat": threat, "motifs": drill.motifs.split()}


async def answer(db: AsyncSession, user: User, drill_id: int, uci: str) -> dict:
    """Ход защиты (или выбор в «Не зевни»): итог, верные ходы, опровержения и прогресс темы."""
    session, drill = await _active(db, user, drill_id, "move")
    board = chess.Board(drill.fen)
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        raise DomainValueError("illegal_move", move=uci) from None
    if move not in board.legal_moves:
        raise DomainValueError("illegal_move", move=uci)
    if drill.kind == "blunder" and uci not in drill.choices.split():
        raise PuzzleError("drill_not_a_choice", 400, move=uci)

    good = drill.good_moves.split()
    correct = uci in good
    clean = correct and session.clean
    progress = await update_theme_progress(db, user.id, KIND_THEMES[drill.kind], drill.stage, clean=clean)
    await db.commit()
    await redis_module.redis_client.delete(_session_key(user.id))
    refutations = dict(pair.split(":") for pair in drill.refutations.split()) if drill.refutations else {}
    return {
        "correct": correct,
        "clean": clean,
        "good": good,
        "threat": drill.threat,
        "refutations": refutations,
        "motifs": drill.motifs.split(),
        "training": progress,
    }
