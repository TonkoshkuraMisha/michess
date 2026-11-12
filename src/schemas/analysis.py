# --- FILE: src/schemas/analysis.py ---

from pydantic import BaseModel, Field


class PositionAnalysisRequest(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=1000, description="Список ходов в формате SAN или UCI")
    start_fen: str | None = Field(
        default=None, max_length=120,
        description="Начальная позиция (FEN), от которой сделаны ходы; по умолчанию — обычная расстановка",
    )


class MoveEvaluationItem(BaseModel):
    ply: int
    move_number: int
    color: str
    san: str
    uci: str
    eval_cp: int
    eval_display: str
    mate: int | None = None
    best_move_uci: str | None = None
    cp_loss: int
    classification: str
    symbol: str


class SideSummaryStats(BaseModel):
    accuracy: float
    best: int
    good: int
    inaccuracies: int
    mistakes: int
    blunders: int
    avg_cp_loss: float


class FullGameAnalysisResponse(BaseModel):
    game_id: int
    engine: str
    white: SideSummaryStats
    black: SideSummaryStats
    moves: list[MoveEvaluationItem]
