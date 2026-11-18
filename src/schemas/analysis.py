# --- FILE: src/schemas/analysis.py ---
"""
Формат запросов и ответов разбора и наставника (src/api/analysis.py): оценка позиции, полный разбор партии с
классификацией ходов и точностью сторон, совет, подсказка по ступеням, проверка хода, итог партии.

Текстов для игрока здесь нет: комментарий наставника — список предложений {ключ шаблона, параметры}, по которым
клиент собирает фразу на своём языке (каталог coach), плюс стрелки и подсветка полей для доски.
"""

from pydantic import BaseModel, Field


class PositionAnalysisRequest(BaseModel):
    """Запрос оценки позиции (POST /analysis/position): позиция задаётся ходами от начальной расстановки или от FEN."""
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
    """Подсветка поля на доске; kind — вид подсветки, по которому клиент выбирает цвет."""
    square: str
    kind: str


class CoachComment(BaseModel):
    """Комментарий наставника к ходу или позиции: предложения (ключи шаблонов), стрелки и подсветка полей."""
    comment: list[CoachSentence]
    arrows: list[CoachArrow] = Field(default_factory=list)
    highlights: list[CoachHighlight] = Field(default_factory=list)


class MoveEvaluationItem(BaseModel):
    """
    Один ход в разборе партии: номер и сторона, запись хода, оценка позиции после него, лучший ход движка, потеря в
    сантипешках, класс хода и комментарий наставника. Класс и знак считает
    analysis_service.classify_move_by_cp_loss: Best «!» (потеря до 10 сантипешек или первая линия движка), Good
    (до 45), Inaccuracy «?!» (до 95), Mistake «?» (до 199), Blunder «??» (от 200). eval_display — оценка с точки
    зрения белых в виде строки («+1.4», «M3»).
    """
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
    """
    Итог разбора для одной стороны: точность в процентах (среднее по ходам, формула —
    analysis_service.calculate_move_accuracy), число ходов каждого класса и средняя потеря в сантипешках.
    """
    accuracy: float
    best: int
    good: int
    inaccuracies: int
    mistakes: int
    blunders: int
    avg_cp_loss: float


class AdviceRequest(BaseModel):
    """Запрос совета наставника (POST /analysis/advice)."""
    fen: str = Field(..., max_length=100, description="Позиция, по которой нужен совет (ходит сторона игрока)")


class AdviceResponse(CoachComment):
    """Совет наставника: комментарий со стрелками, лучший ход и оценка позиции."""
    fen: str
    best_move_uci: str | None = None
    eval_cp: int | None = Field(default=None, description="Оценка с точки зрения белых; None — движок недоступен")


class HintRequest(BaseModel):
    fen: str = Field(..., max_length=100)
    step: int = Field(1, ge=1, le=3, description="Ступень: 1 — намёк, 2 — фигура, 3 — ход")


class HintResponse(BaseModel):
    """Подсказка одной ступени (POST /analysis/hint); best_move_uci заполняется только на последней ступени."""
    fen: str
    step: int
    final: bool = Field(description="Последняя ступень: ход показан, дальше подсказывать нечего")
    best_move_uci: str | None = None
    comment: list[CoachSentence]
    arrows: list[CoachArrow] = []
    highlights: list[CoachHighlight] = []


class DisputeRequest(BaseModel):
    """«Не согласен» с предупреждением наставника (POST /analysis/dispute): позиция, ход и показанная потеря."""
    fen: str = Field(..., max_length=100)
    move: str = Field(..., min_length=4, max_length=5)
    cp_loss: int | None = Field(default=None, ge=0, le=20000)


class MoveCheckRequest(BaseModel):
    """Запрос проверки хода в игре с наставником (POST /analysis/check-move)."""
    fen: str = Field(..., max_length=100, description="Позиция до хода игрока")
    move: str = Field(..., min_length=4, max_length=5, description="Ход игрока в UCI")


class MoveCheckResponse(BaseModel):
    """Проверка хода. available=False — движка нет, проверка не проводилась (остальные поля пустые)."""
    available: bool
    cp_loss: int | None = None
    classification: str | None = None
    symbol: str | None = None
    eval_before: int | None = Field(default=None, description="Оценка до хода с точки зрения сходившего")
    eval_after: int | None = Field(default=None, description="Оценка после хода с точки зрения сходившего")
    best_move_uci: str | None = None
    reply_uci: str | None = None
    missed_tactic: bool = False
    coach: CoachComment | None = None


class KeyMoments(BaseModel):
    """Ключевые моменты стороны в итоге партии: полуходы её лучшего и худшего хода (None — выделить нечего)."""
    best_ply: int | None = None
    worst_ply: int | None = None


class GameSummary(BaseModel):
    """Итог партии (таск 11.5), см. src/services/game_summary.py."""
    kind: str = Field(description="seesaw | decisive_blunder | domination | missed_win | balanced | gradual")
    turning_point_ply: int | None = None
    lead_changes: int
    equal_share: float
    white: KeyMoments
    black: KeyMoments


class FullGameAnalysisResponse(BaseModel):
    """
    Полный разбор партии. Хранится в games.analysis_json (для импортированных — imported_games.analysis_json);
    format_version — analysis_service.ANALYSIS_FORMAT_VERSION: разбор другой версии считается устаревшим и
    пересчитывается. summary в базе не хранится — считается при каждом ответе (src/services/game_summary.py).
    """
    game_id: int
    format_version: int
    engine: str
    white: SideSummaryStats
    black: SideSummaryStats
    moves: list[MoveEvaluationItem]
    summary: GameSummary | None = None
