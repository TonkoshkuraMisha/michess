# --- FILE: src/services/onboarding.py ---
"""
Первый вход (таск 17.8): два необязательных вопроса при регистрации — как давно играете и примерная сила — дают
стартовый рейтинг. По нему подбираются соперники и задачи с первой партии; пока партий в категории меньше
PROVISIONAL_GAMES, рейтинг временный (K = 40 и пометка в интерфейсе) и быстро догоняет настоящую силу.

Без ответов — прежние 1200. «Только узнал правила» — самый низкий старт, сила тогда не спрашивается.
"""

from typing import Literal

Experience = Literal["new", "casual", "regular"]
StrengthBand = Literal["under_1000", "1000_1400", "1400_1800", "over_1800"]

DEFAULT_RATING = 1200
BEGINNER_RATING = 600
# Середины диапазонов, с поправкой вниз у верхнего: заявленная сила обычно выше настоящей.
BAND_RATINGS: dict[str, int] = {"under_1000": 800, "1000_1400": 1200, "1400_1800": 1550, "over_1800": 1850}
# Без оценки силы: «играю иногда» — чуть ниже середины шкалы, «играю регулярно» — середина.
EXPERIENCE_RATINGS: dict[str, int] = {"casual": 1000, "regular": DEFAULT_RATING}


def starting_rating(experience: Experience | None, strength: StrengthBand | None) -> int:
    if experience == "new":
        return BEGINNER_RATING
    if strength is not None:
        return BAND_RATINGS[strength]
    if experience is not None:
        return EXPERIENCE_RATINGS[experience]
    return DEFAULT_RATING
