# --- FILE: src/api/analysis.py ---

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.schemas.analysis import FullGameAnalysisResponse, PositionAnalysisRequest
from src.services.analysis_service import analysis_service

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])


@router.post("/position")
async def analyze_game_position(
        request: PositionAnalysisRequest,
        db: AsyncSession = Depends(get_db),
):
    """Возвращает оценку позиции Stockfish для заданного массива ходов."""
    return await analysis_service.analyze_position(db, request.moves)


@router.post("/game/{game_id}", response_model=FullGameAnalysisResponse)
async def analyze_full_game_endpoint(
        game_id: int,
        force: bool = Query(default=False, description="Принудительно пересчитать анализ"),
        db: AsyncSession = Depends(get_db),
):
    """Выполняет полный разбор завершённой партии с расчётом точности и классификацией зевков."""
    try:
        return await analysis_service.analyze_full_game(db, game_id, force=force)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
