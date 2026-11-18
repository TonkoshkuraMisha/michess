# --- FILE: src/services/course_progress.py ---
"""
Автозачёт шагов Большого курса и программ (задача 6 плана владельца 18.11, таски 27.6 и 22.3): сводка того, что
игрок уже выполнил, по нормативам ниже. Шаги курса — данные клиента (frontend/src/content/supercourse.ts), поэтому
сервер отдаёт выполненное по видам упражнений, а клиент сопоставляет с шагами (services/courseProgress.ts).

Откуда и по какому нормативу:
* уроки, азбука, курс матов, эндшпильный тренажёр, мини-игры — таблица lesson_progress: запись с completed_at
  (урок пройден до конца, упражнение эндшпиля или мини-игра выиграны); отдаются id записей как есть, ключи
  строит клиент тем же способом, что и при записи;
* темы задач — theme_progress: тема засчитана, когда пройдена хотя бы THEME_PASS_STAGE ступеней (переход на
  ступень — puzzles.STAGE_PASS чистых решений из STAGE_WINDOW подряд) или тема освоена целиком;
* тренажёры — trainer_results: засчитан, если сделано не меньше TRAINER_MIN_ATTEMPTS попыток (порогов очков у
  тренажёров нет: уровни у каждого свои);
* экзамены — exam_results: последняя оценка по каждому разделу; правило «экзамен уровня сдан» (оценка не ниже цели
  уровня) — у клиента рядом с целями уровней (supercourse.levelExamPassed).
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.lesson import LessonProgress
from src.models.puzzle import ThemeProgress
from src.models.trainer import TrainerResult
from src.services import exam

# Тема засчитана после перехода с первой ступени на вторую (8 чистых из 10 на ступени «знакомство»).
THEME_PASS_STAGE = 2
# Тренажёр засчитан после первой законченной попытки.
TRAINER_MIN_ATTEMPTS = 1


def theme_passed(stage: int, mastered: bool) -> bool:
    """Норматив темы: достигнута ступень THEME_PASS_STAGE или тема освоена."""
    return mastered or stage >= THEME_PASS_STAGE


async def summary(db: AsyncSession, user_id: int) -> dict:
    """
    {lessons: [id выполненных записей lesson_progress], themes: [засчитанные темы], trainers: [засчитанные
    тренажёры], exams: {раздел: последняя оценка}} — всё отсортировано, чтобы ответ был стабильным.
    """
    lessons = (await db.execute(select(LessonProgress.lesson_id).where(
        LessonProgress.user_id == user_id, LessonProgress.completed_at.is_not(None)))).scalars().all()
    themes = (await db.execute(select(ThemeProgress.theme, ThemeProgress.stage, ThemeProgress.mastered).where(
        ThemeProgress.user_id == user_id))).all()
    trainers = (await db.execute(
        select(TrainerResult.trainer).where(TrainerResult.user_id == user_id)
        .group_by(TrainerResult.trainer).having(func.count() >= TRAINER_MIN_ATTEMPTS))).scalars().all()
    exams = (await exam.latest(db, user_id))["sections"]
    return {
        "lessons": sorted(lessons),
        "themes": sorted(code for code, stage, mastered in themes if theme_passed(stage, mastered)),
        "trainers": sorted(trainers),
        "exams": {section: result["estimate"] for section, result in sorted(exams.items())},
    }
