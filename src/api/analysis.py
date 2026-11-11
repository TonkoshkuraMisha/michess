# --- FILE: src/api/analysis.py ---

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.fair_play import forbid_engine_help_during_game
from src.api.rate_limit import rate_limit
from src.db.session import get_db
from src.models.game import Game
from src.schemas.analysis import FullGameAnalysisResponse, PositionAnalysisRequest
from src.services.analysis_service import GameNotFinishedError, analysis_service, ensure_game_finished
from src.services.engine_pool import EngineBusyError

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])

# game_id -> [lock, число запросов, ожидающих или держащих лок]. Запись удаляется, когда
# счётчик падает до нуля, поэтому словарь не растёт с каждой когда-либо анализированной партией.
_ANALYSIS_LOCKS: dict[int, list] = {}


@asynccontextmanager
async def _game_analysis_lock(game_id: int):
    entry = _ANALYSIS_LOCKS.setdefault(game_id, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _ANALYSIS_LOCKS.pop(game_id, None)


def _engine_busy() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Движок сейчас занят, повторите запрос через несколько секунд",
        headers={"Retry-After": "5"},
    )


@router.post(
    "/position",
    dependencies=[
        Depends(rate_limit(
            "analysis_position", "RATE_LIMIT_POSITION_ANALYSIS", "RATE_LIMIT_POSITION_ANALYSIS_GUEST",
        )),
        Depends(forbid_engine_help_during_game),
    ],
)
async def analyze_game_position(
        request: PositionAnalysisRequest,
        db: AsyncSession = Depends(get_db),
):
    """
    Возвращает оценку позиции Stockfish для заданного массива ходов.
    Недоступно, пока у запрашивающего идёт рейтинговая партия (см. src/api/fair_play.py).
    """
    try:
        return await analysis_service.analyze_position(db, request.moves)
    except EngineBusyError:
        raise _engine_busy() from None


@router.get("/game/{game_id}", response_model=FullGameAnalysisResponse | None)
async def get_cached_game_analysis(
        game_id: int,
        db: AsyncSession = Depends(get_db),
):
    """Возвращает уже сохранённый компьютерный анализ завершённой партии из БД, если он есть."""
    game = await db.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail=f"Партия {game_id} не найдена")
    try:
        ensure_game_finished(game)
    except GameNotFinishedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not game.analysis_json:
        return None
    try:
        data = json.loads(game.analysis_json)
        data["game_id"] = game_id
        return data
    except Exception:
        return None


@router.post(
    "/game/{game_id}",
    response_model=FullGameAnalysisResponse,
    dependencies=[Depends(rate_limit("analysis_game", "RATE_LIMIT_GAME_ANALYSIS"))],
)
async def analyze_full_game_endpoint(
        game_id: int,
        force: bool = Query(default=False, description="Принудительно пересчитать анализ"),
        db: AsyncSession = Depends(get_db),
):
    """
    Выполняет полный разбор завершённой партии с расчётом точности и классификацией зевков.
    Идущие партии не анализируются (409). Параллельные запросы на одну партию сериализуются,
    чтобы не занимать несколько движков пула одной и той же работой.
    """
    async with _game_analysis_lock(game_id):
        try:
            return await analysis_service.analyze_full_game(db, game_id, force=force)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except GameNotFinishedError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except EngineBusyError:
            raise _engine_busy() from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
