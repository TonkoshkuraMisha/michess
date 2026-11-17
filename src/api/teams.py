# --- FILE: src/api/teams.py ---
"""
Команды и сезонная лига (таск 17.2): таблица лиги за сезон (календарный месяц), страница команды, создание
команды, вступление и выход. Игрок состоит не больше чем в одной команде. Правила очков и состав таблицы —
src/services/league.py; очки считаются по сыгранным партиям при запросе, отдельной таблицы результатов нет.
"""

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import league

router = APIRouter(dependencies=[Depends(rate_limit("teams", "RATE_LIMIT_PUZZLES"))])

SEASON = r"^\d{4}-(0[1-9]|1[0-2])$"
_CODES = {"team_not_found": status.HTTP_404_NOT_FOUND, "team_name_invalid": status.HTTP_400_BAD_REQUEST}


def _http(exc: DomainError):
    return exc.to_http(_CODES.get(exc.code, status.HTTP_409_CONFLICT))


class TeamCreate(BaseModel):
    name: str = Field(..., max_length=60)


@router.get("/league")
async def league_table(season: str | None = Query(None, pattern=SEASON), db: AsyncSession = Depends(get_db)):
    return await league.table(db, season)


@router.get("/mine")
async def my_team(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    team = await league.team_of(db, user.id)
    return {"team": await league.team_view(db, team.id) if team else None}


@router.get("/{team_id}")
async def get_team(team_id: int, season: str | None = Query(None, pattern=SEASON), db: AsyncSession = Depends(get_db)):
    try:
        return await league.team_view(db, team_id, season)
    except DomainError as exc:
        raise _http(exc) from None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_team(payload: TeamCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        team = await league.create_team(db, user, payload.name)
    except DomainError as exc:
        raise _http(exc) from None
    return await league.team_view(db, team.id)


@router.post("/{team_id}/join")
async def join_team(team_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        await league.join_team(db, user, team_id)
    except DomainError as exc:
        raise _http(exc) from None
    return await league.team_view(db, team_id)


@router.post("/leave")
async def leave_team(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        await league.leave_team(db, user)
    except DomainError as exc:
        raise _http(exc) from None
    return {"team": None}
