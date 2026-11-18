# --- FILE: src/services/conferences.py ---
"""
Конференции (таск 33.6, docs/research/arenas.md §9): командное соревнование поверх общего пула арен.

Пять конференций названы по сторонам света от Украины; каждая страна мира — ровно в одной (таблица COUNTRIES ниже,
ключи конференций — те же, что у расписания: arena_schedule.CONFERENCE_ZONES). Пары в аренах по-прежнему создаются
по силе со всего мира, но каждое очко игрока идёт и в зачёт его конференции.

Откуда берутся данные:

* принадлежность — страна в профиле игрока (users.country, двухбуквенный код ISO 3166-1; выбирает сам игрок).
  По адресу в сети страна только предлагается: её может назвать прокси перед сервером в заголовке
  (настройка COUNTRY_HEADER, например «CF-IPCountry»); сам сервер адреса со странами не сопоставляет и ничего об
  этом не хранит. Без страны — без конференции: игрок играет, но очков конференции не приносит;
* смена конференции — не чаще одного раза за сезон (сезон — календарный месяц UTC, как в лиге команд), чтобы нельзя
  было перейти в выигрывающую. Первый выбор сменой не считается; смена страны внутри той же конференции свободна;
  убрать страну можно всегда (это личные данные), но это тоже расходует смену сезона (users.country_season);
* зачёт арены — конференция игрока запоминается при входе в арену (arena_players.conference), поэтому поздняя смена
  страны итогов не переписывает. Очки конференции в арене — сумма очков её TOP_PLAYERS лучших участников (чтобы
  большая аудитория не выигрывала числом);
* Кубок конференций — сумма зачётов всех арен, начавшихся в сезоне; считается из arena_players при запросе;
* матчи конференций (формат арены "match", правила — conference_match_rules.py) — список matches: матчи сезона и
  ближайшие, со счётом сторон из arena_players.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.errors import DomainError
from src.models.arena import Arena, ArenaPlayer
from src.models.user import User
from src.services.arena_schedule import CONFERENCE_ZONES
from src.services.league import season_bounds

# Сколько лучших участников конференции идёт в её зачёт одной арены.
TOP_PLAYERS = 10

# Страны по конференциям — 250 кодов (ISO 3166-1 alpha-2 и XK — Косово, у которого официального кода нет), каждый
# код встречается один раз. Правило из решения
# владельца: Центральная — Украина и соседи до Балтии и Кавказа; Западная — запад Европы и обе Америки; Северная —
# Германия, Британия, Скандинавия; Южная — Италия, Балканы, Турция, Ближний Восток и вся Африка; Восточная — Россия,
# Беларусь, вся остальная Азия, Австралия и Океания. Малые государства и территории — по ближайшему соседу.
COUNTRIES: dict[str, tuple[str, ...]] = {
    "central": (
        "UA", "PL", "MD", "RO", "SK", "CZ", "HU", "LT", "LV", "EE", "GE", "AM", "AZ",
    ),
    "western": (
        # Европа
        "FR", "ES", "PT", "BE", "NL", "LU", "CH", "AT", "AD", "MC", "LI", "GI",
        # Северная, Центральная и Южная Америка, Карибы
        "AI", "AG", "AR", "AW", "BS", "BB", "BZ", "BM", "BO", "BQ", "BR", "VG", "CA", "KY", "CL", "CO", "CR", "CU",
        "CW", "DM", "DO", "EC", "SV", "FK", "GF", "GD", "GP", "GT", "GY", "HT", "HN", "JM", "MQ", "MX", "MS", "NI",
        "PA", "PY", "PE", "PR", "BL", "KN", "LC", "MF", "PM", "VC", "SX", "SR", "TT", "TC", "US", "UY", "VE", "VI",
        "GL", "GS", "BV",
    ),
    "northern": (
        "DE", "GB", "IE", "DK", "NO", "SE", "FI", "IS", "FO", "AX", "SJ", "IM", "JE", "GG",
    ),
    "southern": (
        # Европа
        "IT", "GR", "AL", "BA", "HR", "ME", "MK", "RS", "SI", "XK", "BG", "SM", "VA", "MT",
        # Турция, Кипр, Ближний Восток
        "TR", "CY", "SY", "LB", "IL", "PS", "JO", "IQ", "IR", "SA", "YE", "OM", "AE", "QA", "BH", "KW",
        # Африка
        "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER",
        "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "YT", "MA",
        "MZ", "NA", "NE", "NG", "RE", "RW", "SH", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN",
        "UG", "EH", "ZM", "ZW", "IO", "TF",
        # Антарктида
        "AQ",
    ),
    "eastern": (
        "RU", "BY",
        # Центральная и Южная Азия
        "KZ", "UZ", "TM", "KG", "TJ", "IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF",
        # Восточная и Юго-Восточная Азия
        "CN", "JP", "KR", "KP", "MN", "TW", "HK", "MO", "TH", "VN", "LA", "KH", "MM", "MY", "SG", "ID", "PH", "BN",
        "TL",
        # Австралия и Океания
        "AU", "NZ", "PG", "FJ", "SB", "VU", "NC", "PF", "WS", "TO", "TV", "KI", "NR", "PW", "FM", "MH", "GU", "MP",
        "AS", "CK", "NU", "TK", "WF", "PN", "NF", "CX", "CC", "HM", "UM",
    ),
}
# Обратная таблица: код страны → ключ конференции.
CONFERENCE_OF: dict[str, str] = {code: key for key, codes in COUNTRIES.items() for code in codes}
# Конференции таблицы стран и расписания арен должны совпадать: расхождение — ошибка в одном из двух модулей.
assert set(COUNTRIES) == set(CONFERENCE_ZONES), "conference keys differ between the country table and the schedule"


def conference_of(country: str | None) -> str | None:
    """Конференция страны; без страны или с незнакомым кодом — None."""
    return CONFERENCE_OF.get((country or "").upper())


def current_season(now: datetime | None = None) -> str:
    """Ключ текущего сезона «ГГГГ-ММ» (календарный месяц UTC, league.season_bounds)."""
    return season_bounds(None, now)[0]


def membership(user: User, now: datetime | None = None) -> dict:
    """
    Страна и конференция игрока и можно ли сейчас сменить конференцию (одна смена за сезон): смена доступна, пока
    в users.country_season не записан текущий сезон.
    """
    return {"country": user.country, "conference": conference_of(user.country),
            "can_change": user.country_season != current_season(now)}


async def set_country(db: AsyncSession, user: User, country: str | None, now: datetime | None = None) -> dict:
    """
    Страна в профиле. Первый выбор и смена страны внутри той же конференции — свободно; смена конференции (в том
    числе выход из неё) — раз в сезон: вторая попытка в том же сезоне — отказ country_change_too_soon. Убрать страну
    можно всегда, но это расходует смену сезона. Код страны не из таблицы COUNTRIES — отказ country_unknown.
    Возвращает membership.
    """
    code = country.upper() if country else None
    if code is not None and code not in CONFERENCE_OF:
        raise DomainError("country_unknown")
    season = current_season(now)
    old, new = conference_of(user.country), conference_of(code)
    first_choice = user.country is None and user.country_season is None
    if new != old and not first_choice:
        if new is not None and user.country_season == season:
            raise DomainError("country_change_too_soon", season=season)
        user.country_season = season
    user.country = code
    await db.commit()
    return membership(user, now)


def suggested_country(headers: Mapping[str, str]) -> str | None:
    """Страна, которую назвал прокси перед сервером (заголовок из настройки COUNTRY_HEADER), — только как подсказка."""
    name = settings.COUNTRY_HEADER
    code = (headers.get(name) or "").strip().upper() if name else ""
    return code if code in CONFERENCE_OF else None


def team_scores(rows: Iterable[tuple[str | None, int]]) -> list[dict]:
    """
    Зачёт конференций одной арены по парам (конференция игрока, его очки): сумма TOP_PLAYERS лучших. Возвращает
    строки {"conference", "score", "counted", "players"} — по убыванию очков (при равенстве — в порядке таблицы
    COUNTRIES); конференции без участников нет. counted — сколько игроков вошло в сумму, players — сколько играло.
    """
    by_conference: dict[str, list[int]] = defaultdict(list)
    for conference, score in rows:
        if conference in COUNTRIES:
            by_conference[conference].append(score)
    table = []
    for conference, scores in by_conference.items():
        best = sorted(scores, reverse=True)[:TOP_PLAYERS]
        table.append({"conference": conference, "score": sum(best), "counted": len(best), "players": len(scores)})
    order = list(COUNTRIES)
    return sorted(table, key=lambda row: (-row["score"], order.index(row["conference"])))


async def arena_table(db: AsyncSession, arena_id: int) -> list[dict]:
    """Зачёт конференций арены — по конференциям, запомненным у участников при входе."""
    rows = (await db.execute(select(ArenaPlayer.conference, ArenaPlayer.score).where(
        ArenaPlayer.arena_id == arena_id, ArenaPlayer.conference.is_not(None)))).all()
    return team_scores((conference, score) for conference, score in rows)


async def cup(db: AsyncSession, season: str | None = None, now: datetime | None = None) -> dict:
    """
    Кубок конференций за сезон: сумма зачётов арен (и швейцарок), начавшихся в этом месяце. В таблице всегда все пять
    конференций: {"conference", "score", "arenas"} — arenas: в скольких аренах конференция набрала очки. Берутся
    участники с очками больше нуля; каждое деление арены — отдельная запись arenas и считается отдельно.
    """
    key, start, end = season_bounds(season, now)
    rows = (await db.execute(
        select(ArenaPlayer.arena_id, ArenaPlayer.conference, ArenaPlayer.score)
        .join(Arena, Arena.id == ArenaPlayer.arena_id)
        .where(Arena.starts_at >= start, Arena.starts_at < end, ArenaPlayer.conference.is_not(None),
               ArenaPlayer.score > 0)
    )).all()
    by_arena: dict[int, list[tuple[str | None, int]]] = defaultdict(list)
    for arena_id, conference, score in rows:
        by_arena[arena_id].append((conference, score))
    scores = dict.fromkeys(COUNTRIES, 0)
    arenas = dict.fromkeys(COUNTRIES, 0)
    for entries in by_arena.values():
        for row in team_scores(entries):
            scores[row["conference"]] += row["score"]
            arenas[row["conference"]] += 1
    order = list(COUNTRIES)
    ranked = sorted(COUNTRIES, key=lambda conference: (-scores[conference], order.index(conference)))
    table = [{"conference": conference, "score": scores[conference], "arenas": arenas[conference]}
             for conference in ranked]
    return {"season": key, "top_players": TOP_PLAYERS, "table": table}


async def matches(db: AsyncSession, season: str | None = None, now: datetime | None = None) -> list[dict]:
    """
    Матчи конференций сезона и ещё не начавшиеся: {"arena_id", "home", "guest", "starts_at", "status", "home_score",
    "guest_score", "players"} по порядку начала. Счёт — очки арены сторон в единицах матча (победа 1, ничья ½).
    """
    from src.services import arena as arena_service
    from src.services import conference_match_rules as match_rules

    now = now or datetime.now(UTC)
    _, start, end = season_bounds(season, now)
    rows = list((await db.execute(select(Arena).where(
        Arena.format == "match", or_(Arena.starts_at.between(start, end), Arena.starts_at > now))
        .order_by(Arena.starts_at, Arena.id))).scalars())
    if not rows:
        return []
    totals = (await db.execute(select(ArenaPlayer.arena_id, ArenaPlayer.conference, func.sum(ArenaPlayer.score),
                                      func.count()).where(ArenaPlayer.arena_id.in_([a.id for a in rows]))
                               .group_by(ArenaPlayer.arena_id, ArenaPlayer.conference))).all()
    score = {(arena_id, conference): (int(points), int(count)) for arena_id, conference, points, count in totals}
    out = []
    for item in rows:
        home, guest = score.get((item.id, item.conference), (0, 0)), score.get((item.id, item.opponent_conference), (0, 0))
        out.append({"arena_id": item.id, "home": item.conference, "guest": item.opponent_conference,
                    "starts_at": arena_service._aware(item.starts_at).isoformat(),
                    "status": arena_service.status(item, now), "home_score": match_rules.side_score(home[0]),
                    "guest_score": match_rules.side_score(guest[0]), "players": home[1] + guest[1]})
    return out
