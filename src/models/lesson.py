# --- FILE: src/models/lesson.py ---
"""
Прогресс уроков школы (таск 14.1). Сами уроки — файлы данных клиента (frontend/src/content/lessons/*.json):
тексты уроков на трёх языках живут там же, где остальные тексты интерфейса. Сервер хранит только, докуда игрок
дошёл в уроке и как сдал контрольные вопросы.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class LessonProgress(Base):
    __tablename__ = "lesson_progress"
    __table_args__ = (UniqueConstraint("user_id", "lesson_id", name="uq_lesson_progress_user_lesson"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    lesson_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Дальний пройденный шаг (номер с нуля): к нему возвращает «Продолжить».
    step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    steps_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Лучший результат контрольных вопросов урока (верно с первой попытки) из exam_total.
    exam_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exam_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
