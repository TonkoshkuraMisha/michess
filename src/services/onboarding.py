# --- FILE: src/services/onboarding.py ---
"""
Первый вход (таск 17.8): два необязательных вопроса при регистрации — как давно играете и примерная сила — дают
стартовый рейтинг. По нему подбираются соперники и задачи с первой партии; пока партий в категории меньше
PROVISIONAL_GAMES, рейтинг временный (K = 40 и пометка в интерфейсе) и быстро догоняет настоящую силу.

Без ответов — прежние 1200. «Только узнал правила» — самый низкий старт, сила тогда не спрашивается.

Кто применяет: регистрация (src/api/auth.py) записывает стартовое значение сразу во все категории игрового рейтинга
и в рейтинг задач (колонки users.*_rating). Без ответов действуют значения по умолчанию модели: игра — 1200,
задачи — 1500. PROVISIONAL_GAMES — константа src/services/rating.py.
"""

from typing import Literal

Experience = Literal["new", "casual", "regular"]
StrengthBand = Literal["under_1000", "1000_1400", "1400_1800", "over_1800"]

DEFAULT_RATING = 1200  # старт без ответов и для «играю регулярно» без оценки силы; равен умолчанию модели User
BEGINNER_RATING = 600  # «только узнал правила»
# Середины диапазонов, с поправкой вниз у двух верхних (1550 вместо 1600): заявленная сила обычно выше настоящей.
BAND_RATINGS: dict[str, int] = {"under_1000": 800, "1000_1400": 1200, "1400_1800": 1550, "over_1800": 1850}
# Без оценки силы: «играю иногда» — чуть ниже середины шкалы, «играю регулярно» — середина.
EXPERIENCE_RATINGS: dict[str, int] = {"casual": 1000, "regular": DEFAULT_RATING}


def starting_rating(experience: Experience | None, strength: StrengthBand | None) -> int:
    """
    Стартовый рейтинг по ответам, по убыванию приоритета: новичок — BEGINNER_RATING (сила не учитывается);
    названа сила — BAND_RATINGS; назван только опыт — EXPERIENCE_RATINGS; иначе DEFAULT_RATING.
    """
    if experience == "new":
        return BEGINNER_RATING
    if strength is not None:
        return BAND_RATINGS[strength]
    if experience is not None:
        return EXPERIENCE_RATINGS[experience]
    return DEFAULT_RATING
