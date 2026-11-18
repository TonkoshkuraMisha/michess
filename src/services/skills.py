"""
Карта навыков (таск 22.1): сильные и слабые стороны игрока по уже собранным данным — без новых таблиц.

* Тактика: решаемость задач по разделам A–L каталога тем (попытки × темы задач) и самые слабые темы.
* Ошибки в своих партиях (13.5): какие темы чаще всего упускались.
* Тренажёры зрения, памяти и счёта (19): попытки и лучший результат.
* Дебюты (20): карточки репертуаров — выучено / в работе / новые.
* Эндшпиль (14.4) и матовые конструкции (14.6): пройденные упражнения.

Только для самого игрока: данные тренировок — личные.

Откуда данные: puzzle_attempts и puzzle_themes (тактика; учитываются все попытки, включая забеги и курс матов),
personal_puzzles (ошибки в партиях), trainer_results (тренажёры), repertoires и repertoire_cards (дебюты),
lesson_progress (эндшпиль и маты: пройденные записи с идентификатором «endgame-…» и «mates-…»), exam_results
(диагностика, src/services/exam.py). Маршрут — src/api/skills.py; слабые темы берёт и разминка
(src/services/workout.py). Сам модуль ничего не пишет.
"""

from collections import Counter

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.lesson import LessonProgress
from src.models.puzzle import PersonalPuzzle, PuzzleAttempt, PuzzleTheme
from src.models.repertoire import Repertoire, RepertoireCard
from src.models.trainer import TrainerResult
from src.models.user import User
from src.services import exam
from src.services.personal_puzzles import split_themes
from src.services.themes import SECTIONS, THEMES

MIN_ATTEMPTS = 5  # меньше — оценки раздела или темы нет («мало данных»)
WEAK_THEMES = 5  # сколько слабых тем и сколько частых тем своих ошибок показывается
# «Всего» для полосы прогресса эндшпиля. Число записано вручную и с данными не сверяется: в
# frontend/src/content/endgames.json на 17.11.2026 — 34 упражнения (см. также ``lessons_done``).
ENDGAME_EXERCISES = 25
MATE_CONSTRUCTIONS = 20  # «всего» конструкций курса матов; то же число, что len(mate_course.COURSE)
SECTION_OF = {theme.code: theme.section for theme in THEMES}  # код темы → раздел каталога (A–L)


def _percent(solved: int, total: int) -> int | None:
    """Доля решённых в процентах; None — попыток меньше MIN_ATTEMPTS, оценка была бы случайной."""
    return round(100 * solved / total) if total >= MIN_ATTEMPTS else None


async def tactics(db: AsyncSession, user_id: int) -> tuple[list[dict], list[dict]]:
    """
    Решаемость по разделам и самые слабые темы (не меньше MIN_ATTEMPTS попыток). Попытка задачи с несколькими
    темами засчитывается каждой из них. Слабые — WEAK_THEMES тем с наименьшей долей решённых; при равной доле
    первой идёт тема с большим числом попыток.
    """
    rows = (await db.execute(
        select(PuzzleTheme.theme, func.count(), func.sum(case((PuzzleAttempt.solved, 1), else_=0)))
        .join(PuzzleAttempt, PuzzleAttempt.puzzle_id == PuzzleTheme.puzzle_id)
        .where(PuzzleAttempt.user_id == user_id)
        .group_by(PuzzleTheme.theme)
    )).all()
    by_section: dict[str, list[int]] = {section: [0, 0] for section in SECTIONS}
    themes = []
    for theme, total, solved in rows:
        section = SECTION_OF.get(theme)
        if section is None:
            continue
        by_section[section][0] += int(solved or 0)
        by_section[section][1] += int(total)
        score = _percent(int(solved or 0), int(total))
        if score is not None:
            themes.append({"theme": theme, "section": section, "attempts": int(total), "score": score})
    sections = [{"section": section, "attempts": total, "score": _percent(solved, total)}
                for section, (solved, total) in by_section.items()]
    weakest = sorted(themes, key=lambda t: (t["score"], -t["attempts"]))[:WEAK_THEMES]
    return sections, weakest


async def mistakes(db: AsyncSession, user_id: int) -> dict:
    """
    Ошибки в своих партиях: сколько личных задач всего, сколько исправлено и какие темы встречаются чаще других.
    У задачи может быть несколько тем — каждая считается; коды вне реестра тем пропускаются.
    """
    rows = (await db.execute(
        select(PersonalPuzzle.themes, PersonalPuzzle.done).where(PersonalPuzzle.user_id == user_id)
    )).all()
    counter: Counter[str] = Counter()
    for themes, _ in rows:
        counter.update(code for code in split_themes(themes) if code in SECTION_OF)
    return {"total": len(rows), "fixed": sum(1 for _, done in rows if done),
            "themes": [{"theme": theme, "count": count} for theme, count in counter.most_common(WEAK_THEMES)]}


async def trainers(db: AsyncSession, user_id: int) -> list[dict]:
    """Тренажёры зрения, памяти и счёта (trainer_results): число попыток, лучший счёт и наибольший уровень каждого."""
    rows = (await db.execute(
        select(TrainerResult.trainer, func.count(), func.max(TrainerResult.score), func.max(TrainerResult.level))
        .where(TrainerResult.user_id == user_id).group_by(TrainerResult.trainer).order_by(TrainerResult.trainer)
    )).all()
    return [{"trainer": trainer, "attempts": attempts, "best": best, "max_level": level}
            for trainer, attempts, best, level in rows]


async def openings(db: AsyncSession, user_id: int) -> dict:
    """
    Карточки повторения репертуаров (20.2): выучено — интервал от 6 дней. Правило то же, что
    repertoire_drill.status; число 6 здесь повторено (repertoire_drill.LEARNED_DAYS).
    """
    rows = (await db.execute(
        select(RepertoireCard.first_reviewed_at.is_(None), RepertoireCard.interval_days >= 6, func.count())
        .join(Repertoire, Repertoire.id == RepertoireCard.repertoire_id)
        .where(Repertoire.user_id == user_id)
        .group_by(RepertoireCard.first_reviewed_at.is_(None), RepertoireCard.interval_days >= 6)
    )).all()
    counts = {"new": 0, "learning": 0, "learned": 0}
    for is_new, learned, count in rows:
        counts["new" if is_new else "learned" if learned else "learning"] += int(count)
    repertoires = await db.scalar(select(func.count()).select_from(Repertoire).where(Repertoire.user_id == user_id))
    return {"repertoires": repertoires or 0, **counts}


async def lessons_done(db: AsyncSession, user_id: int, prefix: str) -> int:
    """
    Сколько записей lesson_progress игрока с идентификатором на prefix пройдено. Итоговая проверка курса матов
    («mates-exam») не считается. Считаются все идентификаторы с таким началом: под «endgame-» попадают и упражнения
    эндшпильного тренажёра, и уроки школы с идентификатором «endgame-…».
    """
    return await db.scalar(select(func.count()).select_from(LessonProgress).where(
        LessonProgress.user_id == user_id, LessonProgress.lesson_id.like(f"{prefix}%"),
        LessonProgress.completed_at.is_not(None), LessonProgress.lesson_id != "mates-exam",
    )) or 0


async def skill_map(db: AsyncSession, user: User) -> dict:
    """
    Карта навыков игрока: тактика по разделам каталога, слабые темы, свои ошибки, тренажёры, дебюты, эндшпиль и
    матовые конструкции.
    """
    sections, weakest = await tactics(db, user.id)
    return {
        "username": user.username,
        "puzzle_rating": user.puzzle_rating,
        "sections": sections,
        "weakest_themes": weakest,
        "mistakes": await mistakes(db, user.id),
        "trainers": await trainers(db, user.id),
        "openings": await openings(db, user.id),
        "endgames": {"done": await lessons_done(db, user.id, "endgame-"), "total": ENDGAME_EXERCISES},
        "mates": {"done": await lessons_done(db, user.id, "mates-"), "total": MATE_CONSTRUCTIONS},
        # Диагностический экзамен (22.0) — стартовые данные, пока попыток задач мало.
        "exam": await exam.latest(db, user.id),
    }
