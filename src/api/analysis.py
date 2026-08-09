from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.schemas.analysis import PositionAnalysisRequest
from src.services.analysis_service import analysis_service

router = APIRouter(prefix="/analysis", tags=["Game Analysis"])

@router.post("/position")
async def analyze_game_position(
    request: PositionAnalysisRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Возвращает оценку позиции Stockfish и статистику продолжений из базы партий для заданного массива ходов.
    """
    result = await analysis_service.analyze_position(db, request.moves)
    return result