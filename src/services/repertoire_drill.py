"""
Повторение репертуара (таск 20.2). Карточка — позиция репертуара, где ход за игроком: «найди свой ход» (верны все
свои ходы из позиции). Расписание — SM-2: верный ответ растит интервал (1 день, 6 дней, дальше × лёгкость), ошибка
сбрасывает его на завтра и снижает лёгкость; в той же сессии клиент показывает карточку ещё раз (повтор не меняет
расписание). Новые карточки — не больше дневной нормы, от коротких линий к длинным.

«Игра против репертуара»: соперник отвечает ходами из своих ответов репертуара, чаще — популярными у людей (по
индексу позиций 16.1); нет ответов — линия пройдена.
"""

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import chess
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainValueError
from src.models.repertoire import Repertoire, RepertoireCard
from src.services import position_index
from src.services import repertoire as service

NEW_PER_DAY = 10
SESSION = 20
LEARNED_DAYS = 6
MIN_EASE = 1.3


@dataclass
class Spot:
    """Позиция с ходом игрока: как до неё дойти и какие ходы верны."""

    position: str
    line: list[str]
    answers: list[dict] = field(default_factory=list)


def spots(repertoire: Repertoire, edges: list[service.Edge]) -> dict[str, Spot]:
    """Позиции-карточки: кратчайшая линия к позиции (по обходу в ширину) и свои ходы из неё."""
    line_to: dict[str, list[str]] = {service.ROOT: []}
    found: dict[str, Spot] = {}
    for edge in edges:
        line = line_to.get(edge.position)
        if line is None:
            continue
        line_to.setdefault(edge.child, [*line, edge.uci])
        if edge.mine:
            spot = found.setdefault(edge.position, Spot(edge.position, line))
            spot.answers.append({"uci": edge.uci, "san": edge.san, "comment": edge.comment})
    return found


def status(card: RepertoireCard) -> str:
    if card.first_reviewed_at is None:
        return "new"
    return "learned" if card.interval_days >= LEARNED_DAYS else "learning"


def schedule(card: RepertoireCard, correct: bool, now: datetime) -> None:
    """SM-2 с оценкой 4 за верный ответ и 1 за ошибку."""
    quality = 4 if correct else 1
    card.ease = max(MIN_EASE, card.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if correct:
        card.repetitions += 1
        card.interval_days = 1 if card.repetitions == 1 else LEARNED_DAYS if card.repetitions == 2 \
            else round(card.interval_days * card.ease)
    else:
        card.repetitions = 0
        card.lapses += 1
        card.interval_days = 1
    card.due_at = now + timedelta(days=card.interval_days)
    card.first_reviewed_at = card.first_reviewed_at or now
    card.last_reviewed_at = now


def _aware(moment: datetime | None) -> datetime | None:
    """SQLite в тестах возвращает время без пояса — считаем его UTC."""
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment


async def sync_cards(db: AsyncSession, repertoire: Repertoire) -> tuple[dict[str, Spot], dict[str, RepertoireCard]]:
    """Карточки = позиции с ходом игрока: новые позиции получают карточку, исчезнувшие — теряют."""
    found = spots(repertoire, service.build_tree(repertoire.color, await service.load_moves(db, repertoire.id)))
    cards = {c.position: c for c in (await db.execute(
        select(RepertoireCard).where(RepertoireCard.repertoire_id == repertoire.id)
    )).scalars().all()}
    gone = [c.id for key, c in cards.items() if key not in found]
    if gone:
        await db.execute(delete(RepertoireCard).where(RepertoireCard.id.in_(gone)))
    for key in found:
        if key not in cards:
            card = RepertoireCard(repertoire_id=repertoire.id, position=key, ease=2.5, interval_days=0, repetitions=0,
                                  lapses=0)
            db.add(card)
            cards[key] = card
    await db.flush()
    return found, {key: card for key, card in cards.items() if key in found}


def stats(cards: dict[str, RepertoireCard], now: datetime) -> dict:
    """
    Сводка карточек репертуара: всего, новых, в работе, выученных, к повторению сейчас и сколько новых ещё можно взять
    сегодня (NEW_PER_DAY).
    """
    counts = {"new": 0, "learning": 0, "learned": 0}
    due = new_today = 0
    for card in cards.values():
        counts[status(card)] += 1
        due_at, first = _aware(card.due_at), _aware(card.first_reviewed_at)
        if due_at is not None and due_at <= now:
            due += 1
        if first is not None and first.date() == now.date():
            new_today += 1
    return {"total": len(cards), **counts, "due": due, "new_left": max(0, NEW_PER_DAY - new_today)}


def _fen(line: list[str]) -> str:
    board = chess.Board()
    for uci in line:
        board.push_uci(uci)
    return board.fen()


async def session(db: AsyncSession, repertoire: Repertoire, mode: str, now: datetime) -> dict:
    """review — сначала просроченные, затем новые в пределах дневной нормы; learn — только новые, без нормы."""
    found, cards = await sync_cards(db, repertoire)
    summary = stats(cards, now)
    # Срок есть у отвеченных карточек и у поставленных «потренировать» после партии (20.3), даже ещё новых.
    overdue = sorted((key for key, card in cards.items() if (due := _aware(card.due_at)) is not None and due <= now),
                     key=lambda key: _aware(cards[key].due_at) or now)
    fresh = sorted((key for key, card in cards.items() if status(card) == "new" and key not in overdue),
                   key=lambda key: (len(found[key].line), found[key].line))
    if mode == "learn":
        chosen = fresh[:SESSION // 2]
    else:
        chosen = overdue[:SESSION]
        chosen += fresh[:max(0, min(summary["new_left"], SESSION - len(chosen)))]
    return {
        "stats": summary,
        "cards": [{"position": key, "line": found[key].line, "fen": _fen(found[key].line),
                   "answers": found[key].answers, "status": status(cards[key])} for key in chosen],
    }


async def answer(db: AsyncSession, repertoire: Repertoire, position: str, uci: str, retry: bool,
                 now: datetime) -> dict:
    """
    Ответ на карточку: верен любой свой ход из этой позиции. Расписание повторений меняет только первый ответ; повтор
    в той же сессии (retry) его не трогает.
    """
    found, cards = await sync_cards(db, repertoire)
    if position not in found:
        raise DomainValueError("repertoire_move_not_found")
    answers = found[position].answers
    correct = any(a["uci"] == uci for a in answers)
    card = cards[position]
    if not retry:
        schedule(card, correct, now)
    return {"correct": correct, "answers": answers, "status": status(card),
            "due_at": due.isoformat() if (due := _aware(card.due_at)) else None,
            "stats": stats(cards, now)}


async def opponent_reply(db: AsyncSession, repertoire: Repertoire, moves: list[str],
                         rng: random.Random | None = None) -> dict:
    """Ответ соперника из репертуара; чаще — тот, что популярнее у людей. Нет ответов — линия пройдена."""
    pairs = service.parse_line(moves)
    board = chess.Board()
    for _, uci in pairs:
        board.push_uci(uci)
    side = chess.WHITE if repertoire.color == "white" else chess.BLACK
    if board.turn == side:
        raise DomainValueError("illegal_move", move=moves[-1] if moves else "")
    key = service.position_key(board)
    options = [e for e in service.build_tree(repertoire.color, await service.load_moves(db, repertoire.id))
               if e.position == key and not e.mine]
    if not options:
        return {"reply": None, "san": None}
    popularity = {s.move_uci: s.games for s in await position_index.moves_from(db, board)}
    weights = [popularity.get(e.uci, 0) + 1 for e in options]
    choice = (rng or random.Random()).choices(options, weights=weights)[0]
    return {"reply": choice.uci, "san": choice.san}


def utcnow() -> datetime:
    return datetime.now(UTC)


async def focus(db: AsyncSession, repertoire: Repertoire, position: str, now: datetime) -> None:
    """Поставить карточку позиции в сегодняшнее повторение (после ошибки в партии, таск 20.3)."""
    _, cards = await sync_cards(db, repertoire)
    card = cards.get(position)
    if card is None:
        raise DomainValueError("repertoire_move_not_found")
    card.due_at = now
