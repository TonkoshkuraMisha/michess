# --- FILE: src/api/game_import.py ---
"""
Импорт партий с lichess, chess.com и из PGN (таск 24.1): список, разбор с наставником, личные задачи.

Только для вошедших: партии привязаны к игроку. Во время партии с человеком импорт и разбор закрыты
(forbid_engine_help_during_game): иначе в «импорт» можно было бы вставить PGN идущей партии и получить оценку
движка. Частота импорта — RATE_LIMIT_GAME_IMPORT за RATE_LIMIT_GAME_IMPORT_WINDOW_S на игрока; разбор — общий
лимит анализа партий.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.analysis import GAME_ANALYSIS_QUOTA, _engine_busy, _game_analysis_lock
from src.api.deps import get_current_user
from src.api.fair_play import forbid_engine_help_during_game
from src.api.rate_limit import enforce_rate_limit, rate_limit
from src.core.config import settings
from src.core.errors import DomainValueError
from src.db.session import get_db
from src.models.imported_game import ImportedGame
from src.models.user import User
from src.schemas.analysis import FullGameAnalysisResponse
from src.services import game_import, personal_puzzles
from src.services.engine_pool import EngineBusyError, engine_work
from src.services.game_summary import summarize
from src.services.task_dispatch import schedule_imported_analyses_in_background

router = APIRouter()


class SiteImportRequest(BaseModel):
    source: Literal["lichess", "chesscom"]
    username: str = Field(..., min_length=2, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    max: int = Field(10, ge=1, le=50)


class PgnImportRequest(BaseModel):
    pgn: str = Field(..., min_length=1, max_length=game_import.MAX_PGN_CHARS)
    player: str = Field("", max_length=game_import.NAME_MAX, description="Ваше имя в заголовках PGN")
    max: int = Field(10, ge=1, le=50)


async def import_rate_limit(user: User = Depends(get_current_user)) -> None:
    await enforce_rate_limit("game_import", f"user:{user.id}", settings.RATE_LIMIT_GAME_IMPORT,
                             settings.RATE_LIMIT_GAME_IMPORT_WINDOW_S, "import_rate_limited")


def _limit(requested: int) -> int:
    return max(1, min(requested, settings.GAME_IMPORT_MAX_GAMES))


async def _finish(db: AsyncSession, user: User, result: dict) -> dict:
    """Новые партии — в фоновый разбор (и задачи из ошибок); клиенту — их карточки."""
    added_ids: list[int] = result["added"]
    schedule_imported_analyses_in_background(added_ids)
    games = [await db.get(ImportedGame, imported_id) for imported_id in added_ids]
    return {"added": [game_import.view(game) for game in games if game is not None],
            "duplicates": result["duplicates"], "skipped": result["skipped"]}


def _http(exc: game_import.GameImportError):
    headers = {"Retry-After": str(exc.params["retry_after"])} if "retry_after" in exc.params else None
    return exc.to_http(exc.status_code, headers=headers)


@router.post("/fetch", dependencies=[Depends(forbid_engine_help_during_game), Depends(import_rate_limit)])
async def import_from_site(payload: SiteImportRequest, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """Последние партии игрока с lichess или chess.com по нику."""
    try:
        result = await game_import.import_from_site(db, user, payload.source, payload.username, _limit(payload.max))
    except game_import.GameImportError as exc:
        raise _http(exc) from None
    return await _finish(db, user, result)


@router.post("/pgn", dependencies=[Depends(forbid_engine_help_during_game), Depends(import_rate_limit)])
async def import_pgn(payload: PgnImportRequest, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Партии из вставленного PGN; сторона игрока — по имени в заголовках."""
    try:
        result = await game_import.import_pgn(db, user, payload.pgn, payload.player, _limit(payload.max))
    except game_import.GameImportError as exc:
        raise _http(exc) from None
    return await _finish(db, user, result)


@router.get("/games")
async def list_games(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
                     user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await game_import.list_games(db, user, offset, limit)


async def _own(db: AsyncSession, user: User, imported_id: int) -> ImportedGame:
    try:
        return await game_import.get_own(db, user, imported_id)
    except game_import.GameImportError as exc:
        raise _http(exc) from None


@router.get("/games/{imported_id}")
async def get_game(imported_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    game = await _own(db, user, imported_id)
    return {**game_import.view(game), "puzzle_plies": await personal_puzzles.plies_for_imported(db, game.id, user)}


@router.get("/games/{imported_id}/pgn", response_class=PlainTextResponse)
async def get_pgn(imported_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return (await _own(db, user, imported_id)).pgn


@router.delete("/games/{imported_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_game(imported_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _own(db, user, imported_id)
    await game_import.remove(db, user, imported_id)


def _report(game: ImportedGame, data: dict) -> dict:
    return {**data, "game_id": game.id, "summary": summarize(data.get("moves", []), game.result)}


@router.get("/games/{imported_id}/analysis", response_model=FullGameAnalysisResponse | None,
            dependencies=[Depends(forbid_engine_help_during_game)])
async def get_analysis(imported_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Готовый разбор (после фоновой задачи) или null."""
    game = await _own(db, user, imported_id)
    data = game_import.cached_analysis(game)
    return _report(game, data) if data is not None else None


@router.post(
    "/games/{imported_id}/analysis", response_model=FullGameAnalysisResponse,
    dependencies=[Depends(forbid_engine_help_during_game),
                  Depends(rate_limit("analysis_game", "RATE_LIMIT_GAME_ANALYSIS")), Depends(GAME_ANALYSIS_QUOTA.check)],
)
async def run_analysis(imported_id: int, http: Request, force: bool = Query(default=False),
                       user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Разбор по запросу — если фоновая задача ещё не дошла или брокер недоступен; затем задачи из ошибок."""
    game = await _own(db, user, imported_id)
    async with _game_analysis_lock(f"imported:{imported_id}"):
        try:
            with engine_work("analysis"):
                data = await game_import.analyze(db, game, force=force)
        except EngineBusyError:
            raise _engine_busy() from None
        except DomainValueError as exc:
            raise exc.to_http(400) from exc
    await GAME_ANALYSIS_QUOTA.record(http)
    try:
        await personal_puzzles.extract_for_imported(db, game.id)
    except EngineBusyError:
        pass  # задачи досчитает следующий разбор; сам разбор уже готов
    return _report(game, data)
