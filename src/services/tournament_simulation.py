# --- FILE: src/services/tournament_simulation.py ---
"""
Партии ботов между собой в турнире (таск 15.2). Считаются в Celery, не в API-процессе: турнир на 8 участников —
это 28 партий. Глубина и время поиска понижены, длина партии ограничена: незавершённую к SIM_MAX_PLIES партию
решает оценка движка (статическая — без движка).

Каждая партия сохраняется с настоящим PGN, без рейтинга, с пометкой is_simulation: она не попадает в Live,
архив и статистику профилей и открывается в GameViewer по ссылке из турнира. Одну партию турнира забирает один
воркер (tournament_games.started_at); если воркер упал посреди партии, через CLAIM_TIMEOUT её можно забрать снова.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

import chess
from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.game import Game, GameStatus
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.services import tournaments
from src.services.bots.base import HistoricalBot, analyse_with_stockfish, resolve_stockfish_path, static_board_eval_cp

logger = logging.getLogger(__name__)

SIM_MAX_PLIES = 200
SIM_MAX_DEPTH = 4
SIM_TIME_LIMIT_S = 0.1
ADJUDICATE_CP = 300


def bot_for(player: TournamentPlayer) -> HistoricalBot:
    """Бот участника с пониженной для симуляции глубиной и временем поиска."""
    from src.services.bots import BOT_INSTANCES
    from src.services.bots.archetypes import ARCHETYPES_BY_KEY
    from src.services.bots.personality import BotPersonalityConfig, PersonalityBot

    bot: HistoricalBot
    if player.kind == "bot" and player.bot_key in BOT_INSTANCES:
        bot = type(BOT_INSTANCES[player.bot_key])()
    elif player.kind == "archetype" and player.bot_key in ARCHETYPES_BY_KEY:
        bot = PersonalityBot(ARCHETYPES_BY_KEY[player.bot_key].config)
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
        board=board, engine_path=resolve_stockfish_path(), skill_level=20, uci_elo=None, depth=12,
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
        white: HistoricalBot, black: HistoricalBot,
        max_plies: int = SIM_MAX_PLIES, judge: Callable[[chess.Board], str] = adjudicate,
) -> tuple[list[str], str, str]:
    """Партия бот против бота: (ходы uci, результат, причина завершения)."""
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
    """Сохраняет партию (PGN, пометка симуляции), пишет результат в турнир. Возвращает id партий для симуляции."""
    from src.api.bots import CUSTOM_BOT_ID, _build_pgn_string, _detect_eco_code, _get_or_create_bot_user

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
        pgn_date=now.strftime("%Y.%m.%d"), site="Michess Tournament", eco=_detect_eco_code(moves), is_simulation=True,
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
    # Партия — работа процессора: в отдельном потоке, чтобы не держать цикл событий.
    moves, result, termination = await asyncio.to_thread(
        play, bot_for(seats[tgame.white_seat]), bot_for(seats[tgame.black_seat]),
    )
    logger.info("Tournament %s game %s: %s in %d plies", tournament.id, tgame.id, result, len(moves))
    return await save_and_record(db, tournament, tgame, moves, result, termination)
