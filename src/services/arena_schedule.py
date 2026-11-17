# --- FILE: src/services/arena_schedule.py ---
"""
Расписание арен по конференциям (таск 33.4, docs/research/arenas.md §4, §6, §9).

У каждой конференции — «домашняя» зона времени, и расписание её арен задано в её местном времени (DAY_PLAN):

* вечер (18:00–23:00): блиц 3+2 каждый час (60 мин); через час рядом с ним вторая арена — пуля 2+1 в 18:00 и в 22:00
  (45 мин), а в 20:00 — вечерняя 5+3 (90 мин), главная арена дня;
* ночь и день: блиц 3+2 раз в три часа;
* швейцарки: 10+5 каждый день в 15:00, 15+10 по воскресеньям в 11:00 (по 5 туров).

В одной конференции одновременно идёт не больше двух турниров (проверяется тестом на неделю вперёд). Играть можно в
арене любой конференции: зона времени определяет только то, когда арены идут чаще. Сам список стран конференций и
зачёт — таск 33.6; здесь нужны только ключи конференций и их зоны.

Модуль чистый: по моменту времени возвращает, какие арены должны существовать; создаёт их arena.ensure_schedule.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from src.core.config import settings

# Ключ конференции → её домашняя зона времени (IANA).
CONFERENCE_ZONES: dict[str, str] = {
    "central": "Europe/Kyiv",
    "western": "America/New_York",
    "northern": "Europe/Berlin",
    "southern": "Europe/Istanbul",
    "eastern": "Asia/Kolkata",
}
RATING_BANDS = (1300, 1700, 2100)
SUNDAY = 6


@dataclass(frozen=True)
class Slot:
    key: str
    base_time_ms: int
    increment_ms: int
    duration: timedelta
    format: str = "arena"
    rounds: int = 0


BLITZ = Slot("blitz-3+2", 180_000, 2_000, timedelta(minutes=60))
BULLET = Slot("bullet-2+1", 120_000, 1_000, timedelta(minutes=45))
EVENING = Slot("evening-5+3", 300_000, 3_000, timedelta(minutes=90))
SWISS_DAILY = Slot("swiss-10+5", 600_000, 5_000, timedelta(hours=3), "swiss", 5)
SWISS_WEEKLY = Slot("swiss-15+10", 900_000, 10_000, timedelta(hours=4), "swiss", 5)

# Час местного времени конференции → турнир. Вечер — каждый час и вторая арена через час; остальное время — реже.
DAY_PLAN: tuple[tuple[int, Slot], ...] = (
    (0, BLITZ), (3, BLITZ), (6, BLITZ), (9, BLITZ), (12, BLITZ), (15, BLITZ),
    (15, SWISS_DAILY),
    (18, BLITZ), (19, BLITZ), (20, BLITZ), (21, BLITZ), (22, BLITZ),
    (18, BULLET), (20, EVENING), (22, BULLET),
)
# День недели и час местного времени → турнир раз в неделю.
WEEK_PLAN: tuple[tuple[int, int, Slot], ...] = ((SUNDAY, 11, SWISS_WEEKLY),)


@dataclass(frozen=True)
class Planned:
    """Турнир расписания: ключ (конференция:слот[-uПОТОЛОК]), начало в UTC и параметры."""
    schedule_key: str
    conference: str
    slot: Slot
    starts_at: datetime
    max_rating: int | None = None

    @property
    def ends_at(self) -> datetime:
        return self.starts_at + self.slot.duration


def active_conferences() -> tuple[str, ...]:
    """Конференции, для которых создаются арены: настройка ARENA_CONFERENCES (по умолчанию — все пять)."""
    wanted = [item.strip() for item in settings.ARENA_CONFERENCES.split(",")]
    return tuple(key for key in CONFERENCE_ZONES if key in wanted)


def day_events(conference: str, day: date) -> list[tuple[datetime, Slot]]:
    """Турниры конференции, начинающиеся в этот день её местного времени: (начало в UTC, слот)."""
    zone = ZoneInfo(CONFERENCE_ZONES[conference])
    plan = list(DAY_PLAN) + [(hour, slot) for weekday, hour, slot in WEEK_PLAN if day.weekday() == weekday]
    events = [(datetime(day.year, day.month, day.day, hour, tzinfo=zone).astimezone(UTC), slot) for hour, slot in plan]
    return sorted(events, key=lambda item: (item[0], item[1].key))


def planned(now: datetime, horizon: timedelta) -> list[Planned]:
    """Турниры, которые идут сейчас или начнутся в ближайшие horizon, — по всем активным конференциям."""
    with_bands = settings.ARENA_RATING_BANDS
    out: dict[tuple[str, datetime], Planned] = {}
    for conference in active_conferences():
        today = now.astimezone(ZoneInfo(CONFERENCE_ZONES[conference])).date()
        for offset in (-1, 0, 1, 2):
            for starts_at, slot in day_events(conference, today + timedelta(days=offset)):
                if not (starts_at < now + horizon and starts_at + slot.duration > now):
                    continue
                # Группы по силе (33.2) — копии блиц-арен с потолком рейтинга; включаются, когда аудитория вырастет.
                limits: tuple[int | None, ...] = (None, *RATING_BANDS) if with_bands and slot is BLITZ else (None,)
                for limit in limits:
                    key = f"{conference}:{slot.key}" + (f"-u{limit}" if limit else "")
                    # Переход на зимнее время повторяет час: один ключ и момент — один турнир.
                    out.setdefault((key, starts_at), Planned(key, conference, slot, starts_at, limit))
    return sorted(out.values(), key=lambda item: (item.starts_at, item.schedule_key))


def is_evening(schedule_key: str | None) -> bool:
    """Вечерняя арена 5+3 — главная арена дня своей конференции."""
    return bool(schedule_key) and str(schedule_key).split(":")[-1] == EVENING.key
