# --- FILE: src/api/analysis.py ---

import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.game import Game
from src.schemas.analysis import FullGameAnalysisResponse, PositionAnalysisRequest
from src.services.analysis_service import analysis_service

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])

_ANALYSIS_LOCKS: dict[int, asyncio.Lock] = {}


@router.post("/position")
async def analyze_game_position(
        request: PositionAnalysisRequest,
        db: AsyncSession = Depends(get_db),
):
    """Возвращает оценку позиции Stockfish для заданного массива ходов."""
    return await analysis_service.analyze_position(db, request.moves)


@router.get("/game/{game_id}", response_model=FullGameAnalysisResponse | None)
async def get_cached_game_analysis(
        game_id: int,
        db: AsyncSession = Depends(get_db),
):
    """Возвращает уже сохранённый компьютерный анализ партии из БД, если он есть."""
    game = await db.get(Game, game_id)
    if not game:
        raise HTTPException(status_code=404, detail=f"Партия {game_id} не найдена")
    if not game.analysis_json:
        return None
    try:
        data = json.loads(game.analysis_json)
        data["game_id"] = game_id
        return data
    except Exception:
        return None


@router.post("/game/{game_id}", response_model=FullGameAnalysisResponse)
async def analyze_full_game_endpoint(
        game_id: int,
        force: bool = Query(default=False, description="Принудительно пересчитать анализ"),
        db: AsyncSession = Depends(get_db),
):
    """
    Выполняет полный разбор завершённой партии с расчётом точности и классификацией зевков.
    Защищён по-игровым локом от параллельного запуска нескольких копий Stockfish на одну партию.
    """
    game_lock = _ANALYSIS_LOCKS.setdefault(game_id, asyncio.Lock())
    async with game_lock:
        try:
            return await analysis_service.analyze_full_game(db, game_id, force=force)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
