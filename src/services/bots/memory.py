# --- FILE: src/services/bots/memory.py ---
"""
Память ботов (таск 32.1). Бот остаётся собой — в своём стиле и около заявленной силы, — но помнит сыгранное.

* Дебюты. По каждой сыгранной партии (с людьми — save-game, и в турнирах ботов — симуляция) записывается итог для
  бота у каждого его хода из книги, пока партия не вышла из книги (не дальше BOOK_PLIES полуходов). При выборе хода
  вес книги умножается на book_factor: сглаженный результат (PRIOR виртуальных партий по 50 %) переводится в
  множитель от FACTOR_MIN до FACTOR_MAX. Выбор — только среди ходов его исторической книги: новых вариантов бот не
  придумывает, проигранные просто играет реже.
* Сила. Рейтинг бота пересчитывается по партиям с людьми как у игрока (Эло, коэффициент K) — без партий с помощью,
  вслепую и из своей позиции. Начальное значение — калибровка (calibration.json) или заявленная сила. Если после
  OFFSET_MIN_GAMES партий расхождение с заявленной силой не меньше DRIFT, раз в OFFSET_EVERY партий поправка к UCI_Elo
  бота сдвигается на четверть расхождения (не дальше MAX_OFFSET): бот возвращается к заявленной силе, а не
  заявленная сила подгоняется под бота — рейтинговые партии с ним остаются честными.

Память читается из базы в кэш процесса (refresh, не чаще раза в REFRESH_SECONDS на бота): выбор хода синхронный и
базу не трогает.

* Соперник (таск 32.2). По завершённым партиям с человеком бот помнит итог каждого своего хода книги против именно
  этого игрока. С постоянным соперником (не меньше RIVAL_MIN_GAMES партий) вес хода дополнительно умножается на
  rival_factor от RIVAL_MIN до RIVAL_MAX: варианты, где игрок набирал меньше, — чаще (там ему труднее), где бот
  проигрывал — реже; ход, с которым бот проиграл этому игроку в последний раз, — ещё × LAST_LOSS. Память соперника
  загружается на запрос хода (load_rival) и передаётся в синхронный выбор хода через contextvars: объекты ботов
  общие на все запросы.
* Где соперник ошибается (32.2, по разбору). Когда фоновый разбор партии готов (games.analysis_json, задача
  analyze_game), record_rival_errors отмечает ходы книги бота, после которых игрок в ближайшие ERROR_WINDOW
  полуходов сделал ошибку или зевок (классы ERROR_CLASSES разбора). Вес такого хода против этого игрока — ещё
  × до ERROR_MAX по доле партий с ошибкой: бот охотнее ведёт его в позиции, где тот уже ошибался. Учитываются те же
  партии, что и для итогов соперника: исторический бот, обычная расстановка, без наставника.
"""

import json
import logging
import time
from contextvars import ContextVar
from dataclasses import dataclass, field

import chess
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.bot_memory import BotOpeningStat, BotRating, BotRival, BotRivalStat
from src.models.game import Game, GameStatus
from src.models.user import User

logger = logging.getLogger(__name__)

PRIOR = 4
FACTOR_MIN, FACTOR_MAX = 0.5, 1.5
BOOK_PLIES = 24
K = 16
OFFSET_MIN_GAMES = 50
OFFSET_EVERY = 25
DRIFT = 100
MAX_OFFSET = 150
REFRESH_SECONDS = 300
RIVAL_MIN_GAMES = 2
RIVAL_MIN, RIVAL_MAX = 0.25, 1.75
LAST_LOSS = 0.1
# Ошибка игрока засчитывается ходу книги, если случилась не дальше ERROR_WINDOW полуходов после него.
ERROR_WINDOW = 12
# Классы ходов разбора (analysis_service.classify_move_by_cp_loss), которые считаются ошибкой игрока.
ERROR_CLASSES = ("Mistake", "Blunder")
# Предел добавки к весу хода, после которого игрок ошибался во всех партиях.
ERROR_MAX = 1.5
# Суффикс служебного имени бота, если его имя занято человеком (api/bots._get_or_create_bot_user).
BOT_USERNAME_SUFFIX = "_bot"

_book: dict[str, dict[tuple[str, str], tuple[int, float]]] = {}
_offset: dict[str, int] = {}
_loaded_at: dict[str, float] = {}


@dataclass
class Rival:
    """Память бота об одном игроке на время запроса хода."""
    bot_id: str
    games: int
    moves: dict[tuple[str, str], tuple[int, float, bool]] = field(default_factory=dict)
    # Ход книги → в скольких партиях игрок ошибся вскоре после него (по разбору).
    errors: dict[tuple[str, str], int] = field(default_factory=dict)


_rival: ContextVar[Rival | None] = ContextVar("bot_rival", default=None)


def use_rival(rival: Rival | None) -> None:
    """Соперник текущего запроса (asyncio.to_thread копирует контекст в поток выбора хода)."""
    _rival.set(rival)


def rival_factor(rival: Rival, fen_key: str, uci: str) -> float:
    games, points, last_lost = rival.moves.get((fen_key, uci), (0, 0.0, False))
    if games == 0:
        return 1.0
    rate = (points + 1.0) / (games + 2.0)
    factor = RIVAL_MIN + (RIVAL_MAX - RIVAL_MIN) * rate
    # Доля партий, где игрок ошибся после этого хода; +1 в знаменателе — одна ошибка ещё не закономерность.
    factor *= 1.0 + (ERROR_MAX - 1.0) * rival.errors.get((fen_key, uci), 0) / (games + 1)
    return factor * LAST_LOSS if last_lost else factor


def book_factor(bot_id: str, fen_key: str, uci: str) -> float:
    """Множитель веса хода книги по опыту бота и, если он играет с постоянным соперником, — по партиям с ним."""
    factor = 1.0
    games, points = _book.get(bot_id, {}).get((fen_key, uci), (0, 0.0))
    if games:
        rate = (points + PRIOR * 0.5) / (games + PRIOR)
        factor = FACTOR_MIN + (FACTOR_MAX - FACTOR_MIN) * rate
    rival = _rival.get()
    if rival is not None and rival.bot_id == bot_id and rival.games >= RIVAL_MIN_GAMES:
        factor *= rival_factor(rival, fen_key, uci)
    return factor


def strength_offset(bot_id: str) -> int:
    return _offset.get(bot_id, 0)


def forget() -> None:
    """Очистить кэш процесса (тесты)."""
    _book.clear()
    _offset.clear()
    _loaded_at.clear()


async def refresh(db: AsyncSession, bot_id: str, *, force: bool = False) -> None:
    if not force and time.monotonic() - _loaded_at.get(bot_id, -REFRESH_SECONDS) < REFRESH_SECONDS:
        return
    rows = (await db.execute(select(BotOpeningStat).where(BotOpeningStat.bot_id == bot_id))).scalars().all()
    _book[bot_id] = {(r.fen_key, r.uci): (r.games, r.points) for r in rows}
    rating = await db.get(BotRating, bot_id)
    _offset[bot_id] = rating.offset if rating else 0
    _loaded_at[bot_id] = time.monotonic()


def bot_points(result: str, bot_color: chess.Color) -> float:
    if result == "1/2-1/2":
        return 0.5
    white_won = result == "1-0"
    return 1.0 if white_won == (bot_color == chess.WHITE) else 0.0


def book_moves_played(opening_book: dict, moves_uci: list[str], bot_color: chess.Color) -> list[tuple[str, str]]:
    """Ходы бота из его книги с начала партии — до первого выхода из книги (любой из сторон) или BOOK_PLIES."""
    return [(key, uci) for _, key, uci in book_plies(opening_book, moves_uci, bot_color)]


def book_plies(opening_book: dict, moves_uci: list[str], bot_color: chess.Color) -> list[tuple[int, str, str]]:
    """То же, что book_moves_played, с номером полухода каждого хода (1 — первый ход партии, как ply в разборе)."""
    from src.services.bots.base import normalize_fen_key

    board = chess.Board()
    played: list[tuple[int, str, str]] = []
    for index, uci in enumerate(moves_uci[:BOOK_PLIES]):
        key = normalize_fen_key(board)
        if board.turn == bot_color:
            known = {str(entry[0]) for entry in opening_book.get(key, [])}
            if uci not in known:
                break
            played.append((index + 1, key, uci))
        try:
            board.push_uci(uci)
        except ValueError:
            break
    return played


def erred_after(book: list[tuple[int, str, str]], report_moves: list[dict], player_color: str) -> set[tuple[str, str]]:
    """
    Ходы книги бота, после которых игрок ошибся: в разборе (moves из analysis_json) у хода игрока класс из
    ERROR_CLASSES не дальше ERROR_WINDOW полуходов после хода бота.
    """
    error_plies = [int(item["ply"]) for item in report_moves
                   if item.get("color") == player_color and item.get("classification") in ERROR_CLASSES]
    return {(key, uci) for ply, key, uci in book
            if any(ply < error <= ply + ERROR_WINDOW for error in error_plies)}


async def record_book(db: AsyncSession, bot_id: str, opening_book: dict, moves_uci: list[str],
                      bot_color: chess.Color, result: str) -> int:
    """Записать итог партии ходам книги бота; возвращает, сколько ходов учтено. Коммит — здесь."""
    played = book_moves_played(opening_book, moves_uci, bot_color)
    if not played:
        return 0
    points = bot_points(result, bot_color)
    for fen_key, uci in played:
        row = await db.scalar(select(BotOpeningStat).where(
            BotOpeningStat.bot_id == bot_id, BotOpeningStat.fen_key == fen_key, BotOpeningStat.uci == uci))
        if row is None:
            db.add(BotOpeningStat(bot_id=bot_id, fen_key=fen_key, uci=uci, games=1, points=points))
        else:
            row.games += 1
            row.points += points
    try:
        await db.commit()
    except IntegrityError:  # та же позиция записана параллельной партией — опыт этой партии не критичен
        await db.rollback()
        logger.info("Bot opening stat race for %s", bot_id)
        return 0
    _loaded_at.pop(bot_id, None)
    return len(played)


def expected(rating: float, opponent: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent - rating) / 400))


def next_offset(offset: int, rating: float, declared: int) -> int:
    """Поправка силы: сдвиг на четверть расхождения, если оно не меньше DRIFT; в пределах MAX_OFFSET."""
    gap = declared - rating
    if abs(gap) < DRIFT:
        return offset
    return max(-MAX_OFFSET, min(MAX_OFFSET, offset + round(gap / 4)))


async def record_rating(db: AsyncSession, bot_id: str, declared: int, opponent_rating: int, score: float) -> BotRating:
    """Партия с человеком: рейтинг бота по Эло и, если пора, новая поправка силы. Коммит — здесь."""
    from src.services.bots import calibration

    row = await db.get(BotRating, bot_id)
    if row is None:
        row = BotRating(bot_id=bot_id, rating=float(calibration.strength_of(bot_id, declared).rating), games=0,
                        offset=0, offset_games=0)
        db.add(row)
    row.rating = row.rating + K * (score - expected(row.rating, opponent_rating))
    row.games = (row.games or 0) + 1
    if row.games >= OFFSET_MIN_GAMES and row.games - (row.offset_games or 0) >= OFFSET_EVERY:
        offset = next_offset(row.offset or 0, row.rating, declared)
        if offset != row.offset:
            logger.info("Bot %s strength offset %s -> %s (rating %.0f, declared %s, games %s)",
                        bot_id, row.offset, offset, row.rating, declared, row.games)
        row.offset, row.offset_games = offset, row.games
    await db.commit()
    _offset[bot_id] = row.offset
    return row


async def live_strength(db: AsyncSession) -> dict[str, BotRating]:
    return {r.bot_id: r for r in (await db.execute(select(BotRating))).scalars().all()}

async def load_rival(db: AsyncSession, bot_id: str, user_id: int | None) -> Rival | None:
    """
    Что бот помнит об игроке: сколько партий сыграно и чем кончались ходы, сыгранные против него. None — игрок не
    вошёл или партий с ним ещё не было.
    """
    if user_id is None:
        return None
    summary = await db.scalar(select(BotRival).where(BotRival.bot_id == bot_id, BotRival.user_id == user_id))
    if summary is None:
        return None
    rows = (await db.execute(select(BotRivalStat).where(
        BotRivalStat.bot_id == bot_id, BotRivalStat.user_id == user_id))).scalars().all()
    return Rival(bot_id, summary.games, {(r.fen_key, r.uci): (r.games, r.points, r.last_lost) for r in rows},
                 {(r.fen_key, r.uci): r.errors for r in rows if r.errors})


async def record_rival(db: AsyncSession, bot_id: str, user_id: int, opening_book: dict, moves_uci: list[str],
                       bot_color: chess.Color, result: str) -> None:
    """Завершённая партия с игроком: итог — в сводку соперника и ходам книги бота против него. Коммит — здесь."""
    points = bot_points(result, bot_color)
    summary = await db.scalar(select(BotRival).where(BotRival.bot_id == bot_id, BotRival.user_id == user_id))
    if summary is None:
        db.add(BotRival(bot_id=bot_id, user_id=user_id, games=1, points=points))
    else:
        summary.games += 1
        summary.points += points
    for fen_key, uci in book_moves_played(opening_book, moves_uci, bot_color):
        row = await db.scalar(select(BotRivalStat).where(
            BotRivalStat.bot_id == bot_id, BotRivalStat.user_id == user_id, BotRivalStat.fen_key == fen_key,
            BotRivalStat.uci == uci))
        if row is None:
            db.add(BotRivalStat(bot_id=bot_id, user_id=user_id, fen_key=fen_key, uci=uci, games=1, points=points,
                                last_lost=points == 0.0))
        else:
            row.games += 1
            row.points += points
            row.last_lost = points == 0.0
    try:
        await db.commit()
    except IntegrityError:  # параллельная партия того же игрока с тем же ботом — опыт этой не критичен
        await db.rollback()


async def rivals_of(db: AsyncSession, user_id: int) -> list[BotRival]:
    return list((await db.execute(select(BotRival).where(BotRival.user_id == user_id)
                                  .order_by(BotRival.games.desc()))).scalars().all())


def _bot_id_of(user: User) -> str | None:
    """Исторический бот за записью игрока (имя — id бота, иногда со служебным суффиксом); иначе None."""
    from src.services.bots import BOT_INSTANCES

    if not user.is_bot:
        return None
    name = user.username.removesuffix(BOT_USERNAME_SUFFIX)
    return name if name in BOT_INSTANCES else None


async def record_rival_errors(db: AsyncSession, game_id: int) -> int:
    """
    Ошибки игрока из готового разбора партии с историческим ботом (вызывает задача analyze_game после разбора):
    ходам книги бота против этого игрока добавляется errors. Партия — та же, что учитывает record_rival: законченная,
    из обычной расстановки, без наставника, не персоналия мастерской. Повторный разбор не удваивает счёт
    (BotRival.errors_game_id). Возвращает число отмеченных ходов книги. Коммит — здесь.
    """
    from src.services.bots import BOT_INSTANCES

    game = await db.get(Game, game_id)
    if (game is None or game.status != GameStatus.COMPLETED or not game.analysis_json or game.assisted
            or game.is_simulation or game.personality_name or "[FEN " in (game.pgn or "")):
        return 0
    white, black = await db.get(User, game.white_player_id), await db.get(User, game.black_player_id)
    if white is None or black is None:
        return 0
    bot_id, bot_color, player = _bot_id_of(white), chess.WHITE, black
    if bot_id is None:
        bot_id, bot_color, player = _bot_id_of(black), chess.BLACK, white
    if bot_id is None or player.is_bot:
        return 0
    summary = await db.scalar(select(BotRival).where(BotRival.bot_id == bot_id, BotRival.user_id == player.id))
    if summary is None or (summary.errors_game_id or 0) >= game.id:
        return 0
    report_moves = json.loads(game.analysis_json).get("moves", [])
    book = book_plies(BOT_INSTANCES[bot_id].opening_book, [str(m["uci"]) for m in report_moves], bot_color)
    marked = erred_after(book, report_moves, "black" if bot_color == chess.WHITE else "white")
    for fen_key, uci in marked:
        row = await db.scalar(select(BotRivalStat).where(
            BotRivalStat.bot_id == bot_id, BotRivalStat.user_id == player.id, BotRivalStat.fen_key == fen_key,
            BotRivalStat.uci == uci))
        if row is not None:
            row.errors += 1
    summary.errors_game_id = game.id
    await db.commit()
    return len(marked)
