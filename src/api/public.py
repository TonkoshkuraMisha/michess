# --- FILE: src/api/public.py ---
"""
Открытое API только для чтения (таск 24.3): профиль игрока, его партии и рейтинги, таблица лидеров, сила ботов.

То же, что и так видно на сайте без входа, — в устойчивом виде для своих программ и исследований: адреса под
/api/v1/public не меняются без смены версии. Ничего личного: ни почты, ни настроек, ни незавершённых партий;
удалённые аккаунты профиля не имеют. Лимит — RATE_LIMIT_PUBLIC_API запросов за окно с адреса (или на игрока, если
запрос с токеном); оценок движка и ходов здесь нет, поэтому честной игре API не мешает.
"""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.api import bots as bots_api
from src.api import profile
from src.api.rate_limit import rate_limit
from src.core.config import settings
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.game import Game, GameStatus
from src.models.user import RATING_CATEGORIES, RatingCategory, User
from src.services.bots import calibration
from src.services.rating import classify_time_control

VERSION = 1
MAX_GAMES = 100
MAX_PGN_GAMES = 200

router = APIRouter(dependencies=[Depends(rate_limit("public_api", "RATE_LIMIT_PUBLIC_API", code="public_api_rate_limited"))])

ENDPOINTS = (
    "/api/v1/public",
    "/api/v1/public/players/{username}",
    "/api/v1/public/players/{username}/games",
    "/api/v1/public/players/{username}/games.pgn",
    "/api/v1/public/players/{username}/rating-history",
    "/api/v1/public/games/{id}",
    "/api/v1/public/games/{id}.pgn",
    "/api/v1/public/leaderboard",
    "/api/v1/public/bots",
)


async def _player(db: AsyncSession, username: str) -> User:
    user = await profile._resolve_user(db, username)
    if user is None:
        raise ApiError(404, "user_not_found", username=username)
    return user


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _game_view(game: Game, white: str, black: str) -> dict:
    return {
        "id": game.id, "white": white, "black": black, "result": game.result, "termination": game.termination,
        "rated": game.is_rated, "speed": classify_time_control(game.base_time_ms, game.increment_ms),
        "base_time_s": game.base_time_ms // 1000, "increment_s": game.increment_ms // 1000, "eco": game.eco,
        "finished_at": _iso(game.finished_at), "pgn": f"/api/v1/public/games/{game.id}.pgn",
    }


@router.get("")
async def index():
    """Что есть в API и каков лимит запросов."""
    return {"version": VERSION, "read_only": True, "endpoints": list(ENDPOINTS),
            "rate_limit": {"requests": settings.RATE_LIMIT_PUBLIC_API, "window_s": settings.RATE_LIMIT_WINDOW_S}}


@router.get("/players/{username}")
async def player(username: str, db: AsyncSession = Depends(get_db)):
    user = await _player(db, username)
    games = await db.scalar(select(func.count(Game.id)).where(*profile._archive_conditions(user.id))) or 0
    return {
        "username": user.username, "bot": bool(user.is_bot), "created_at": _iso(user.created_at),
        "ratings": {category: user.rating_for(category) for category in RATING_CATEGORIES},
        "ladder": {"rating": user.ladder_rating, "games": user.ladder_games},
        "games": games,
    }


async def _games(db: AsyncSession, user: User, limit: int, offset: int, rated: bool | None) -> tuple[int, list]:
    white, black = aliased(User), aliased(User)
    conditions = profile._archive_conditions(user.id)
    if rated is not None:
        conditions.append(Game.is_rated.is_(rated))
    total = await db.scalar(select(func.count(Game.id)).where(*conditions)) or 0
    rows = (await db.execute(
        select(Game, white.username, black.username)
        .join(white, Game.white_player_id == white.id).join(black, Game.black_player_id == black.id)
        .where(*conditions).order_by(desc(Game.finished_at), desc(Game.id)).limit(limit).offset(offset)
    )).all()
    return total, list(rows)


@router.get("/players/{username}/games")
async def player_games(username: str, limit: int = Query(20, ge=1, le=MAX_GAMES), offset: int = Query(0, ge=0),
                       rated: bool | None = Query(None, description="Только рейтинговые (true) или только товарищеские"),
                       db: AsyncSession = Depends(get_db)):
    """Завершённые партии игрока, от новых к старым."""
    user = await _player(db, username)
    total, rows = await _games(db, user, limit, offset, rated)
    return {"total": total, "offset": offset, "games": [_game_view(game, white, black) for game, white, black in rows]}


@router.get("/players/{username}/games.pgn", response_class=PlainTextResponse)
async def player_games_pgn(username: str, limit: int = Query(50, ge=1, le=MAX_PGN_GAMES), offset: int = Query(0, ge=0),
                           rated: bool | None = Query(None), db: AsyncSession = Depends(get_db)):
    """Те же партии одним PGN-файлом."""
    user = await _player(db, username)
    total, rows = await _games(db, user, limit, offset, rated)
    text = "\n\n".join((game.pgn or "").strip() for game, _, _ in rows)
    return PlainTextResponse(text + ("\n" if text else ""), media_type="application/x-chess-pgn",
                             headers={"X-Total-Count": str(total)})


@router.get("/players/{username}/rating-history")
async def player_rating_history(username: str, category: RatingCategory = Query("blitz"),
                                limit: int = Query(200, ge=1, le=1000), db: AsyncSession = Depends(get_db)):
    return await profile.get_rating_history(username, category, limit, db)


async def _finished_game(db: AsyncSession, game_id: int) -> Game:
    game = await db.get(Game, game_id)
    if game is None or game.status != GameStatus.COMPLETED or not game.pgn:
        raise ApiError(404, "game_not_found", game_id=game_id)
    return game


@router.get("/games/{game_id}.pgn", response_class=PlainTextResponse)
async def game_pgn(game_id: int, db: AsyncSession = Depends(get_db)):
    game = await _finished_game(db, game_id)
    return PlainTextResponse(game.pgn, media_type="application/x-chess-pgn")


@router.get("/games/{game_id}")
async def game(game_id: int, db: AsyncSession = Depends(get_db)):
    """Завершённая партия: кто играл, итог, контроль. Идущие партии не отдаются."""
    record = await _finished_game(db, game_id)
    white = await db.get(User, record.white_player_id)
    black = await db.get(User, record.black_player_id)
    return _game_view(record, white.username if white else "?", black.username if black else "?")


@router.get("/leaderboard")
async def leaderboard(category: RatingCategory = Query("blitz"), limit: int = Query(50, ge=1, le=100),
                      db: AsyncSession = Depends(get_db)):
    rows = await profile.get_leaderboard(category, limit, db)
    return {"category": category, "players": [{"rank": r["rank"], "username": r["username"], "rating": r["rating"]}
                                              for r in rows]}


@router.get("/bots")
async def bots():
    """Сила ботов: заявленная и измеренная (с ±95 % и числом партий), сведения о калибровке и её журналы."""
    catalog = await bots_api.get_bot_catalog()
    fields = ("id", "declared_rating", "rating", "measured", "games", "ci95")
    return {
        "calibration": catalog["calibration"],
        "bots": [{"kind": kind, **{field: item[field] for field in fields}}
                 for kind, key in (("historical", "historical"), ("archetype", "archetypes")) for item in catalog[key]],
        "runs": calibration.runs(),
    }
