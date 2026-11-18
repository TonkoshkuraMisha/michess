# --- FILE: src/services/conference_match_rules.py ---
"""
Матчи конференций (таск 33.6, «позже»; схема утверждена владельцем 18.11.2026). Чистые правила без базы и сети —
их проверяет простой тест (tests/test_conference_matches.py); партии и таблицы ведёт src/services/arena.py (формат
арены "match"), создаёт матчи по расписанию arena.ensure_schedule.

* Расписание: раз в неделю — матч двух конференций по круговой системе. Пять конференций — PAIRS (десять пар),
  круг — десять недель. Неделя считается от EPOCH (понедельник); в нечётном круге хозяин и гость меняются местами,
  чтобы каждая конференция принимала матчи по очереди.
* Время: суббота MATCH_WEEKDAY, вечер, удобный обеим. Ищется самый ранний час EVENING_HOURS по времени хозяина, который
  и у гостя приходится на вечер; если общего вечера нет — DEFAULT_HOUR по времени хозяина (а хозяин чередуется по
  кругам — значит, в следующей встрече этих двух конференций матч будет в вечер другой).
* Запись: любой игрок одной из двух конференций (страна в профиле), без порогов по силе (правило 7 CLAUDE.md:
  конференция — это команда, а не деление по силе). Запись закрывается за LINEUP_BEFORE до начала: тогда составы уже
  известны.
* Составы: записавшиеся каждой стороны по рейтингу на входе (при равенстве — раньше записавшийся); доска 1 играет с
  доской 1 и так далее, досок — по меньшей стороне, остальные — запасные без партий.
* Партии: два тура, на каждой доске — партия белыми и партия чёрными (в первом туре хозяин белыми на нечётных досках,
  во втором цвета меняются). Контроль MATCH_SLOT (5+3), партии рейтинговые.
* Счёт: победа — 1, ничья — ½; счёт матча — сумма по доскам. В arena_players очки хранятся в единицах арены
  (победа 2, ничья 1), поэтому счёт стороны — их сумма, делённая на POINTS_PER_WIN.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from src.services.arena_schedule import CONFERENCE_ZONES, Slot

# Контроль, длительность (плановое окно двух туров) и число туров матча.
MATCH_SLOT = Slot("match-5+3", 300_000, 3_000, timedelta(hours=2), "match", 2)
# Понедельник, от которого считаются недели круга.
EPOCH = date(2026, 1, 5)
# День матча — суббота (date.weekday(): понедельник — 0).
MATCH_WEEKDAY = 5
# Вечерние часы начала по местному времени (18:00–22:00) и час по умолчанию, если общего вечера нет.
EVENING_HOURS = range(18, 23)
DEFAULT_HOUR = 19
# За сколько до начала закрывается запись и становятся известны составы.
LINEUP_BEFORE = timedelta(hours=1)
# На сколько вперёд создаются матчи расписания: следующий матч виден для записи всю неделю.
MATCH_LOOKAHEAD = timedelta(days=8)
# Очков арены за победу: счёт матча = очки арены / POINTS_PER_WIN (победа 1, ничья ½).
POINTS_PER_WIN = 2

_ORDER = tuple(CONFERENCE_ZONES)


def round_robin(teams: Sequence[str]) -> tuple[tuple[str, str], ...]:
    """
    Все пары круга методом круга: первая команда на месте, остальные (с пустым местом при нечётном числе) вращаются;
    пары туров идут подряд, поэтому в соседние недели играют разные конференции.
    """
    seats: list[str | None] = [*teams, None] if len(teams) % 2 else list(teams)
    rest, pairs = seats[1:], []
    for _ in range(len(seats) - 1):
        current = [seats[0], *rest]
        for i in range(len(seats) // 2):
            a, b = current[i], current[-1 - i]
            if a and b:
                pairs.append((a, b))
        rest = [rest[-1], *rest[:-1]]
    return tuple(pairs)


# Десять пар круга пяти конференций (у каждой с каждой — один матч за круг).
PAIRS = round_robin(_ORDER)


def fixture(week: int) -> tuple[str, str]:
    """(хозяин, гость) матча недели номер week от EPOCH; в нечётном круге стороны меняются."""
    home, guest = PAIRS[week % len(PAIRS)]
    return (guest, home) if (week // len(PAIRS)) % 2 else (home, guest)


def match_start(home: str, guest: str, saturday: date) -> datetime:
    """Начало матча в UTC: самый ранний вечерний час хозяина, который и у гостя вечер; иначе DEFAULT_HOUR хозяина."""
    home_zone, guest_zone = ZoneInfo(CONFERENCE_ZONES[home]), ZoneInfo(CONFERENCE_ZONES[guest])
    for hour in EVENING_HOURS:
        moment = datetime(saturday.year, saturday.month, saturday.day, hour, tzinfo=home_zone)
        if moment.astimezone(guest_zone).hour in EVENING_HOURS:
            return moment.astimezone(UTC)
    return datetime(saturday.year, saturday.month, saturday.day, DEFAULT_HOUR, tzinfo=home_zone).astimezone(UTC)


@dataclass(frozen=True)
class PlannedMatch:
    """Матч расписания: ключ, хозяин, гость, начало в UTC."""
    schedule_key: str
    home: str
    guest: str
    starts_at: datetime

    @property
    def ends_at(self) -> datetime:
        return self.starts_at + MATCH_SLOT.duration


def planned_matches(now: datetime, horizon: timedelta, active: Sequence[str] = _ORDER) -> list[PlannedMatch]:
    """
    Матчи, которые идут сейчас или начнутся в ближайшие horizon. Матч пары, где одна из конференций не в active
    (настройка ARENA_CONFERENCES), не создаётся.
    """
    out = []
    today = now.astimezone(UTC).date()
    first_week = (today - EPOCH).days // 7 - 1
    for week in range(first_week, first_week + horizon.days // 7 + 3):
        home, guest = fixture(week)
        if home not in active or guest not in active:
            continue
        saturday = EPOCH + timedelta(weeks=week, days=MATCH_WEEKDAY)
        starts_at = match_start(home, guest, saturday)
        if starts_at < now + horizon and starts_at + MATCH_SLOT.duration > now:
            out.append(PlannedMatch(f"{home}-{guest}:{MATCH_SLOT.key}", home, guest, starts_at))
    return out


def entry_open(starts_at: datetime, now: datetime) -> bool:
    """Запись открыта: до начала больше LINEUP_BEFORE."""
    return now < starts_at - LINEUP_BEFORE


class Member(Protocol):
    """Записавшийся игрок (ArenaPlayer): только поля, нужные правилам."""
    user_id: int
    rating: int
    conference: str | None


def lineup(members: Sequence[Member], home: str, guest: str,
           joined_order: Sequence[int] | None = None) -> list[tuple[Member, Member]]:
    """
    Доски матча: [(игрок хозяина, игрок гостя)] — стороны по рейтингу на входе (при равенстве — по joined_order,
    списку user_id в порядке записи), досок — по меньшей стороне.
    """
    rank = {uid: i for i, uid in enumerate(joined_order or [m.user_id for m in members])}

    def side(conference: str) -> list[Member]:
        return sorted((m for m in members if m.conference == conference),
                      key=lambda m: (-m.rating, rank.get(m.user_id, len(rank))))

    return list(zip(side(home), side(guest), strict=False))


def board_colors(board: int, round_no: int) -> bool:
    """Хозяин доски board (с 1) в туре round_no (с 1) играет белыми: нечётные доски в первом туре, чётные — во втором."""
    return (board % 2 == 1) == (round_no % 2 == 1)


def side_score(points: int) -> float:
    """Очки арены стороны → счёт матча (победа 1, ничья ½)."""
    return points / POINTS_PER_WIN
