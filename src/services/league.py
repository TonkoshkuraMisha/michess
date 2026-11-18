# --- FILE: src/services/league.py ---
"""
Команды и сезонная лига (таск 17.2). Сезон — календарный месяц (UTC). Очки дают законченные рейтинговые партии
между людьми из РАЗНЫХ команд, сыгранные в сезоне (состав команды — текущий):

* победа: 2 + (рейтинг соперника − свой) / 200, округлённо, от 1 до 4 — победа над сильным стоит больше;
* ничья: 1, а с соперником сильнее на DRAW_BONUS_GAP и больше — 2;
* поражение: 0.

Рейтинги — на начало партии (games.white_initial_rating / black_initial_rating); если рейтинг в партии не записан,
берётся 1200. Партия относится к сезону по времени окончания (games.finished_at). Таблиц с очками нет: очки
считаются при каждом запросе по таблице games и текущим составам (teams, team_members), поэтому переход игрока в
другую команду переносит с ним и его очки сезона. Ключ сезона и его границы (season_bounds) использует и Кубок
конференций (src/services/conferences.py).
"""

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.game import Game, GameStatus
from src.models.team import Team, TeamMember
from src.models.user import User

# Ничья с соперником, который сильнее на столько пунктов рейтинга или больше, приносит 2 очка вместо 1.
DRAW_BONUS_GAP = 200
# Допустимая длина названия команды в знаках (после сжатия пробелов).
NAME_MIN, NAME_MAX = 3, 30


def win_points(mine: int, opponent: int) -> int:
    """
    Очки лиги за победу: 2 плюс по очку за каждые 200 пунктов перевеса соперника в рейтинге (минус — за свой
    перевес), в границах от 1 до 4. Округление — round Python: ровно половина округляется к чётному.
    """
    return max(1, min(4, 2 + round((opponent - mine) / 200)))


def draw_points(mine: int, opponent: int) -> int:
    """Очки лиги за ничью: 1, а с соперником сильнее на DRAW_BONUS_GAP и больше — 2."""
    return 2 if opponent - mine >= DRAW_BONUS_GAP else 1


def season_bounds(season: str | None = None, now: datetime | None = None) -> tuple[str, datetime, datetime]:
    """
    (ключ «ГГГГ-ММ», начало, конец) сезона; по умолчанию — текущий месяц. Начало — первое число месяца в 00:00 UTC,
    конец — первое число следующего месяца (не входит в сезон).
    """
    if season:
        year, month = (int(part) for part in season.split("-"))
    else:
        now = now or datetime.now(UTC)
        year, month = now.year, now.month
    start = datetime(year, month, 1, tzinfo=UTC)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
    return f"{year:04d}-{month:02d}", start, end


async def team_of(db: AsyncSession, user_id: int) -> Team | None:
    """Команда игрока (игрок состоит не больше чем в одной) или None."""
    return (await db.execute(
        select(Team).join(TeamMember, TeamMember.team_id == Team.id).where(TeamMember.user_id == user_id)
    )).scalar_one_or_none()


async def create_team(db: AsyncSession, user: User, name: str) -> Team:
    """
    Создаёт команду: имя от NAME_MIN до NAME_MAX знаков, уникальное без учёта регистра; игрок не должен состоять в
    другой команде. Создатель становится владельцем и первым участником.
    """
    clean = " ".join(name.split())
    if not NAME_MIN <= len(clean) <= NAME_MAX:
        raise DomainError("team_name_invalid", min=NAME_MIN, max=NAME_MAX)
    if await team_of(db, user.id) is not None:
        raise DomainError("team_already_member")
    if await db.scalar(select(Team.id).where(func.lower(Team.name) == clean.lower())) is not None:
        raise DomainError("team_name_taken")
    team = Team(name=clean, owner_id=user.id)
    db.add(team)
    await db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id))
    await db.commit()
    await db.refresh(team)
    return team


async def join_team(db: AsyncSession, user: User, team_id: int) -> Team:
    """Вступление в команду; игрок, уже состоящий в какой-либо команде, получает отказ."""
    team = await db.get(Team, team_id)
    if team is None:
        raise DomainError("team_not_found")
    if await team_of(db, user.id) is not None:
        raise DomainError("team_already_member")
    db.add(TeamMember(team_id=team.id, user_id=user.id))
    await db.commit()
    return team


async def leave_team(db: AsyncSession, user: User) -> None:
    """
    Выйти из команды. Вышел последний участник — команда удаляется; вышел владелец — владельцем становится участник,
    вступивший раньше остальных. Игрок без команды — отказ team_not_member.
    """
    member = (await db.execute(select(TeamMember).where(TeamMember.user_id == user.id))).scalar_one_or_none()
    if member is None:
        raise DomainError("team_not_member")
    team = await db.get(Team, member.team_id)
    await db.delete(member)
    await db.flush()
    rest = (await db.execute(
        select(TeamMember).where(TeamMember.team_id == member.team_id).order_by(TeamMember.joined_at, TeamMember.id)
    )).scalars().first()
    if team is not None:
        if rest is None:
            await db.delete(team)
        elif team.owner_id == user.id:
            team.owner_id = rest.user_id
    await db.commit()


async def season_points(db: AsyncSession, season: str | None = None) -> tuple[str, dict[int, int], dict[int, int]]:
    """
    (сезон, очки по командам, очки по игрокам) — по партиям сезона между разными командами. Берутся законченные
    рейтинговые партии (не симуляции), у которых оба игрока сейчас состоят в командах; партии внутри одной команды и
    партии без обычного результата пропускаются.
    """
    key, start, end = season_bounds(season)
    team_by_user = {uid: tid for uid, tid in (await db.execute(select(TeamMember.user_id, TeamMember.team_id))).all()}
    if not team_by_user:
        return key, {}, {}
    rows = (await db.execute(
        select(Game.white_player_id, Game.black_player_id, Game.result, Game.white_initial_rating,
               Game.black_initial_rating)
        .where(Game.status == GameStatus.COMPLETED, Game.is_rated.is_(True), Game.is_simulation.is_(False),
               Game.finished_at >= start, Game.finished_at < end,
               Game.white_player_id.in_(team_by_user), Game.black_player_id.in_(team_by_user))
    )).all()
    teams: dict[int, int] = {}
    players: dict[int, int] = {}
    for white, black, result, white_rating, black_rating in rows:
        if team_by_user[white] == team_by_user[black] or result not in ("1-0", "0-1", "1/2-1/2"):
            continue
        wr, br = white_rating or 1200, black_rating or 1200
        if result == "1-0":
            earned = {white: win_points(wr, br)}
        elif result == "0-1":
            earned = {black: win_points(br, wr)}
        else:
            earned = {white: draw_points(wr, br), black: draw_points(br, wr)}
        for user_id, value in earned.items():
            players[user_id] = players.get(user_id, 0) + value
            teams[team_by_user[user_id]] = teams.get(team_by_user[user_id], 0) + value
    return key, teams, players


async def table(db: AsyncSession, season: str | None = None) -> dict:
    """Таблица лиги за сезон: команды по убыванию очков, с числом участников и местом."""
    key, team_points, _ = await season_points(db, season)
    rows = (await db.execute(
        select(Team.id, Team.name, func.count(TeamMember.id)).join(TeamMember, TeamMember.team_id == Team.id)
        .group_by(Team.id, Team.name)
    )).all()
    standings = sorted(({"id": tid, "name": name, "members": count, "points": team_points.get(tid, 0)}
                        for tid, name, count in rows), key=lambda r: (-r["points"], r["name"].lower()))
    for place, row in enumerate(standings, 1):
        row["place"] = place
    return {"season": key, "teams": standings}


async def team_view(db: AsyncSession, team_id: int, season: str | None = None) -> dict:
    """Страница команды: состав по убыванию очков за сезон и сумма очков команды."""
    team = await db.get(Team, team_id)
    if team is None:
        raise DomainError("team_not_found")
    key, team_points, player_points = await season_points(db, season)
    members = (await db.execute(
        select(User.id, User.username).join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team_id).order_by(User.username)
    )).all()
    roster = sorted(({"username": name, "points": player_points.get(uid, 0), "owner": uid == team.owner_id}
                     for uid, name in members), key=lambda m: (-m["points"], m["username"].lower()))
    return {"id": team.id, "name": team.name, "season": key, "points": team_points.get(team.id, 0), "members": roster}
