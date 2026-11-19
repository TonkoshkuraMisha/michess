# --- FILE: src/services/tournament_simulation.py ---
"""
Партии ботов между собой в турнире (таск 15.2). Считаются в Celery, не в API-процессе: турнир на 8 участников —
это 28 партий. Глубина и время поиска понижены, длина партии ограничена: незавершённую к SIM_MAX_PLIES партию
решает оценка движка (статическая — без движка).

Сила в симуляции (таск 28.2). Обычный ход бота ограничивает силу опорным ходом Stockfish с UCI_Elo, но тому нужно
время: при 0,1 с на ход рейтинг переставал что-либо значить (замер 17.11: 2400 против 1600 — 3,5 из 8, 2200 против
1700 — 4,5 из 8), а на полном времени партия идёт больше минуты — турнир на 23 участника так не сыграть. Поэтому
у симуляции своя модель (SimulatedPlayer): лучшие ходы оцениваются на полной силе, а участник выбирает среди них
случайно, с весом, который падает с потерей в оценке; чем ниже рейтинг, тем медленнее падает (temperature_cp).
Дебютная книга и стиль участника при этом сохраняются.

Каждая партия сохраняется с настоящим PGN, без рейтинга, с пометкой is_simulation: она не попадает в Live,
архив и статистику профилей и открывается в GameViewer по ссылке из турнира. Одну партию турнира забирает один
воркер (tournament_games.started_at); если воркер упал посреди партии, через CLAIM_TIMEOUT её можно забрать снова.

Данные: таблицы tournament_games, tournament_players, games; опыт дебютов исторических ботов — bots/memory.py;
подстройка архетипов — bots/selfplay.py; Stockfish — только через пул движка (engine_work «simulation»).
Запускает simulate() задача Celery simulate_tournament_game (src/worker/tasks.py); в очередь партии ставит
tournaments.mark_for_queue. play_game и пределы SIM_* использует и самоигра ботов (bots/selfplay.py).
"""

import asyncio
import logging
import math
import random
from collections.abc import Callable
from datetime import UTC, datetime

import chess
from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game, GameStatus
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.services import tournaments
from src.services.bots import memory as bot_memory
from src.services.bots import selfplay
from src.services.bots.base import (
    HistoricalBot,
    analyse_with_stockfish,
    fallback_scores,
    resolve_stockfish_path,
    static_board_eval_cp,
)
from src.services.engine_pool import engine_work

logger = logging.getLogger(__name__)

# Предел длины партии в полуходах: дольше — партию присуждает adjudicate.
SIM_MAX_PLIES = 200
# Потолки глубины и времени поиска (секунды) бота в симуляции: ускоряют партию за счёт качества ходов.
SIM_MAX_DEPTH = 6
SIM_TIME_LIMIT_S = 0.1
# Перевес в сотых пешки, начиная с которого незавершённая партия присуждается победой.
ADJUDICATE_CP = 300
# Сколько лучших ходов оценивается: участник выбирает только среди них, поэтому в позиции с единственным ходом
# число плохих вариантов ограничено.
SIM_CANDIDATES = 8
# «Температура» выбора хода по рейтингу, сп: ход с потерей T выбирается в e раз реже лучшего, дальше вес падает
# круче (степень LOSS_POWER) — зевок фигуры редок даже у слабого. Замер 17.11 (16 партий на пару, партия ≈ 1 с):
# разница 200 пунктов — 69–78 % очков сильному (по Эло 76 %), 400 — 94–97 % (91 %), 800 — 100 % (99 %).
SIM_TEMPERATURE: tuple[tuple[int, float], ...] = ((800, 260.0), (1200, 170.0), (1600, 110.0), (2000, 65.0),
                                                  (2400, 32.0), (2800, 12.0))
# Степень в формуле веса хода: больше 1 — малая потеря почти не штрафуется, большая — резко.
LOSS_POWER = 1.5


def temperature_cp(rating: int) -> float:
    """Температура выбора хода для рейтинга: линейно между опорными точками SIM_TEMPERATURE."""
    points = SIM_TEMPERATURE
    if rating <= points[0][0]:
        return points[0][1]
    for (lo_elo, lo_t), (hi_elo, hi_t) in zip(points, points[1:], strict=False):
        if rating <= hi_elo:
            return lo_t + (hi_t - lo_t) * (rating - lo_elo) / (hi_elo - lo_elo)
    return points[-1][1]


def move_weights(
        scores: dict[chess.Move, float], style: dict[chess.Move, float], temperature: float,
) -> dict[chess.Move, float]:
    """
    Веса ходов: exp(−(потеря / T)^LOSS_POWER), потеря — отставание оценки от лучшего хода. Стиль сдвигает потерю
    не больше чем на половину температуры: характер виден, но плохой ход хорошим не делает.
    """
    best = max(scores.values())
    weights = {}
    for move, cp in scores.items():
        bonus = max(-temperature / 2, min(temperature / 2, style.get(move, 0.0)))
        loss = max(0.0, best - cp - bonus)
        weights[move] = math.exp(-((loss / temperature) ** LOSS_POWER))
    return weights


class SimulatedPlayer:
    """Участник партии ботов: ходит из своей дебютной книги, дальше — по модели силы симуляции (см. модуль)."""

    def __init__(self, bot: HistoricalBot, rating: int, rng: random.Random | None = None):
        """rating задаёт температуру выбора хода; rng подменяют в тестах для воспроизводимости."""
        self.bot = bot
        self.rating = rating
        self.temperature = temperature_cp(rating)
        self.rng = rng or random.Random()

    def choose_move(self, fen: str) -> dict:
        """
        Ход участника симуляции: из дебютной книги, иначе — случайный среди лучших ходов с весом, который падает с
        потерей в оценке (чем ниже рейтинг, тем слабее падает) и растёт с бонусом стиля.
        """
        board = chess.Board(fen)
        book = self.bot._book_move(board)
        if book is not None:
            return {"uci": book[0].uci(), "source": "opening_book"}
        engine_path = self.bot._get_active_engine_path() if self.bot.stockfish_path is not None else None
        scores = analyse_with_stockfish(
            board=board, engine_path=engine_path, depth=self.bot.search_depth, time_limit=self.bot.time_limit,
            multipv=SIM_CANDIDATES,
        ) or fallback_scores(board)
        style = {move: self.bot.evaluate_style_bonus(board, move)[0] for move in scores}
        weights = move_weights(scores, style, self.temperature)
        moves = list(weights)
        move = self.rng.choices(moves, weights=[weights[m] for m in moves], k=1)[0]
        return {"uci": move.uci(), "source": "simulation"}


def simulation_rating(player: TournamentPlayer, historic: bool = False) -> int:
    """
    Сила участника в партиях ботов. Обычно — сила на старте турнира (у бота — измеренная калибровкой: такой он и в
    партии с игроком). В турнире «Машины времени» (historic) у исторического бота берётся заявленная сила: она
    отражает место мастера в истории, а измеренная бывает заметно ниже (Чигорин — 1833 при заявленных 2150), и
    второй призёр Гастингса занимал бы последнее место. Рейтинг игрока по-прежнему считается от измеренной силы.
    """
    from src.api.bots import BOT_METADATA

    if historic and player.kind == "bot" and player.bot_key in BOT_METADATA:
        return int(str(BOT_METADATA[player.bot_key]["rating"]))
    return player.rating


def player_for(player: TournamentPlayer, historic: bool = False) -> SimulatedPlayer:
    """Участник симуляции: его бот (книга, стиль) и сила (simulation_rating)."""
    return SimulatedPlayer(bot_for(player), simulation_rating(player, historic))


def bot_for(player: TournamentPlayer) -> HistoricalBot:
    """Бот участника с пониженной для симуляции глубиной и временем поиска."""
    from src.services.bots import BOT_INSTANCES
    from src.services.bots.archetypes import ARCHETYPES_BY_KEY
    from src.services.bots.personality import BotPersonalityConfig, PersonalityBot

    bot: HistoricalBot
    if player.kind == "bot" and player.bot_key in BOT_INSTANCES:
        bot = type(BOT_INSTANCES[player.bot_key])()
    elif player.kind == "archetype" and player.bot_key in ARCHETYPES_BY_KEY:
        bot = PersonalityBot(selfplay.tuned_config(ARCHETYPES_BY_KEY[player.bot_key]))
    elif player.kind == "personality" and player.config_json:
        bot = PersonalityBot(BotPersonalityConfig.model_validate_json(player.config_json))
    else:
        raise ValueError(f"seat {player.seat} is not a bot ({player.kind})")
    bot.search_depth = min(bot.search_depth, SIM_MAX_DEPTH)
    bot.time_limit = min(bot.time_limit, SIM_TIME_LIMIT_S)
    return bot


def adjudicate(board: chess.Board) -> str:
    """Итог незавершённой партии: перевес больше ADJUDICATE_CP по оценке движка (или статической) — победа."""
    scores = analyse_with_stockfish(
        board=board, engine_path=resolve_stockfish_path(), depth=12,
        time_limit=0.2, multipv=1,
    )
    if scores:
        cp = max(scores.values())
        white_cp = cp if board.turn == chess.WHITE else -cp
    else:
        white_cp = static_board_eval_cp(board, chess.WHITE)
    if white_cp > ADJUDICATE_CP:
        return "1-0"
    if white_cp < -ADJUDICATE_CP:
        return "0-1"
    return "1/2-1/2"


def play_game(
        white: HistoricalBot | SimulatedPlayer, black: HistoricalBot | SimulatedPlayer,
        max_plies: int = SIM_MAX_PLIES, judge: Callable[[chess.Board], str] = adjudicate,
) -> tuple[list[str], str, str]:
    """
    Партия бот против бота: (ходы uci, результат, причина завершения). Не закончившуюся к max_plies партию решает
    judge, причина тогда — «adjudication».
    """
    board = chess.Board()
    moves: list[str] = []
    while not board.is_game_over(claim_draw=True) and board.ply() < max_plies:
        bot = white if board.turn == chess.WHITE else black
        uci = bot.choose_move(board.fen())["uci"]
        board.push_uci(uci)
        moves.append(uci)
    if board.is_game_over(claim_draw=True):
        outcome = board.outcome(claim_draw=True)
        termination = outcome.termination.name.lower() if outcome else "normal"
        return moves, board.result(claim_draw=True), termination
    return moves, judge(board), "adjudication"


async def claim(db: AsyncSession, game_id: int) -> bool:
    """Забирает партию турнира для симуляции; False — её уже считает другой воркер или она сыграна."""
    now = datetime.now(UTC)
    result = await db.execute(
        update(TournamentGame)
        .where(
            TournamentGame.id == game_id,
            TournamentGame.result.is_(None),
            or_(TournamentGame.started_at.is_(None), TournamentGame.started_at < now - tournaments.CLAIM_TIMEOUT),
        )
        .values(started_at=now)
    )
    await db.commit()
    return bool(getattr(result, "rowcount", 0))


def _pgn_name(player: TournamentPlayer) -> str:
    """Имя участника для PGN: исторический бот, архетип или персоналия; без названия — нейтральная запись."""
    from src.api.bots import BOT_METADATA
    from src.services.bots.archetypes import ARCHETYPES_BY_KEY

    if player.kind == "bot" and player.bot_key in BOT_METADATA:
        return str(BOT_METADATA[player.bot_key]["pgn_name"])
    if player.kind == "archetype" and player.bot_key in ARCHETYPES_BY_KEY:
        return ARCHETYPES_BY_KEY[player.bot_key].pgn_name
    return player.personality_name or "Workshop opponent"


async def save_and_record(
        db: AsyncSession, tournament: Tournament, tgame: TournamentGame, moves: list[str], result: str,
        termination: str,
) -> list[int]:
    """
    Сохраняет партию (PGN, пометка is_simulation), пишет результат в турнир и продвигает его. Возвращает id партий,
    которые пора поставить в очередь (tournaments.mark_for_queue).
    """
    from src.api.bots import CUSTOM_BOT_ID, _build_pgn_string, _get_or_create_bot_user
    from src.services.openings import eco_code

    seats = {p.seat: p for p in await tournaments.players_of(db, tournament.id)}
    white, black = seats[tgame.white_seat], seats[tgame.black_seat]

    async def user_id(player: TournamentPlayer) -> int:
        bot_id = player.bot_key if player.kind == "bot" and player.bot_key else CUSTOM_BOT_ID
        return (await _get_or_create_bot_user(db, bot_id)).id

    pgn_text, final_fen = _build_pgn_string(
        moves_uci=moves, white_name=_pgn_name(white), white_elo=white.rating,
        black_name=_pgn_name(black), black_elo=black.rating, result=result,
    )
    now = datetime.now(UTC)
    game = Game(
        white_player_id=await user_id(white), black_player_id=await user_id(black), pgn=pgn_text, board_fen=final_fen,
        result=result, termination=termination, is_rated=False, base_time_ms=tgame.base_time_ms,
        increment_ms=tgame.increment_ms, status=GameStatus.COMPLETED, finished_at=now,
        pgn_date=now.strftime("%Y.%m.%d"), site="Regence Tournament", eco=eco_code(moves), is_simulation=True,
    )
    db.add(game)
    await db.flush()
    await tournaments.record_result(db, tournament, tgame, result, game.id)
    await db.refresh(tournament)
    return await tournaments.mark_for_queue(db, tournament)


async def simulate(db: AsyncSession, tournament_game_id: int, play: Callable = play_game) -> list[int]:
    """
    Играет партию турнира между ботами и записывает её. Возвращает id следующих партий для симуляции
    (пусто, если партию уже забрал другой воркер или турнир закрыт).
    """
    if not await claim(db, tournament_game_id):
        return []
    tgame = await db.get(TournamentGame, tournament_game_id)
    tournament = await db.get(Tournament, tgame.tournament_id) if tgame else None
    if tgame is None or tournament is None or tournament.status != "active":
        return []
    seats = {p.seat: p for p in await tournaments.players_of(db, tournament.id)}
    historic = tournament.event_key is not None
    white_seat, black_seat = seats[tgame.white_seat], seats[tgame.black_seat]
    await selfplay.refresh(db)
    for seat in (white_seat, black_seat):
        if _historical_bot_key(seat):
            await bot_memory.refresh(db, seat.bot_key or "")
    # Партия — работа процессора: в отдельном потоке, чтобы не держать цикл событий.
    with engine_work("simulation"):
        moves, result, termination = await asyncio.to_thread(
            play, player_for(white_seat, historic), player_for(black_seat, historic),
        )
    logger.info("Tournament %s game %s: %s in %d plies", tournament.id, tgame.id, result, len(moves))
    following = await save_and_record(db, tournament, tgame, moves, result, termination)
    await _remember_openings(db, white_seat, black_seat, moves, result)
    return following


def _historical_bot_key(player: TournamentPlayer) -> str | None:
    """Ключ исторического бота участника (у него есть книга и память дебютов); для остальных None."""
    from src.services.bots import BOT_INSTANCES

    return player.bot_key if player.kind == "bot" and player.bot_key in BOT_INSTANCES else None


async def _remember_openings(db: AsyncSession, white: TournamentPlayer, black: TournamentPlayer, moves: list[str],
                             result: str) -> None:
    """Опыт турнира ботов (таск 32.1): итог партии — дебютным ходам исторических ботов; на рейтинг не влияет."""
    from src.services.bots import BOT_INSTANCES

    for player, color in ((white, chess.WHITE), (black, chess.BLACK)):
        key = _historical_bot_key(player)
        if key is None:
            continue
        try:
            await bot_memory.record_book(db, key, BOT_INSTANCES[key].opening_book, moves, color, result)
        except Exception as exc:  # партия уже записана в турнир — опыт не критичен
            await db.rollback()
            logger.warning("Bot memory update failed for %s: %s", key, exc)
