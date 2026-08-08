from pydantic import BaseModel, Field

class PositionAnalysisRequest(BaseModel):
    """Схема для передачи последовательности ходов на анализ позиции."""
    moves: list[str] = Field(default=[], description="Список ходов от начала партии в формате UCI (например, ['e2e4', 'e7e5'])")