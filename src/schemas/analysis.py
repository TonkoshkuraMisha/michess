# --- FILE: src/schemas/analysis.py ---

from pydantic import BaseModel, Field


class PositionAnalysisRequest(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=1000, description="Список ходов в формате SAN или UCI")
    start_fen: str | None = Field(
        default=None, max_length=120,
        description="Начальная позиция (FEN), от которой сделаны ходы; по умолчанию — обычная расстановка",
    )


class CoachSentence(BaseModel):
    """Предложение наставника: ключ шаблона каталога coach на клиенте и параметры (фигуры — фигурной нотацией)."""
    key: str
    params: dict[str, str | int] = Field(default_factory=dict)


class CoachArrow(BaseModel):
    """Стрелка на доске: best — лучший ход, threat — угроза соперника, idea — тактика лучшего/сделанного хода."""
    from_: str = Field(alias="from")
    to: str
    kind: str

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class CoachHighlight(BaseModel):
    square: str
    kind: str


class CoachComment(BaseModel):
    comment: list[CoachSentence]
    arrows: list[CoachArrow] = Field(default_factory=list)
    highlights: list[CoachHighlight] = Field(default_factory=list)


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
    coach: CoachComment | None = None


class SideSummaryStats(BaseModel):
    accuracy: float
    best: int
    good: int
    inaccuracies: int
    mistakes: int
    blunders: int
    avg_cp_loss: float


class AdviceRequest(BaseModel):
    fen: str = Field(..., max_length=100, description="Позиция, по которой нужен совет (ходит сторона игрока)")


class AdviceResponse(CoachComment):
    fen: str
    best_move_uci: str | None = None
    eval_cp: int | None = Field(default=None, description="Оценка с точки зрения белых; None — движок недоступен")


class FullGameAnalysisResponse(BaseModel):
    game_id: int
    format_version: int
    engine: str
    white: SideSummaryStats
    black: SideSummaryStats
    moves: list[MoveEvaluationItem]
