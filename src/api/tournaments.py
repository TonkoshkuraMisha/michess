# --- FILE: src/api/tournaments.py ---
"""
Турниры с историческими мастерами (таск 15.1): создание, список своих и состояние турнира. Результаты партий
сюда не присылаются — их приносят сохранение партии игрока (15.3) и симуляция партий ботов (15.2).
"""

from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.core.errors import ApiError, DomainError
from src.db.session import get_db
from src.models.tournament import Tournament, TournamentGame, TournamentPlayer
from src.models.user import User
from src.services import tournament_rules as rules
from src.services import tournaments as service

router = APIRouter()

# Ошибки, которые означают конфликт с состоянием, а не неверный запрос.
_CONFLICTS = {"tournament_active_exists", "tournament_game_closed"}


class ParticipantIn(BaseModel):
    kind: Literal["bot", "archetype", "personality"]
    id: str | int = Field(..., description="id бота, id архетипа или id персоналии игрока")


class TournamentCreate(BaseModel):
    format: Literal["round_robin", "knockout"]
    size: int = Field(..., ge=4, le=8)
    participants: list[ParticipantIn] = Field(..., min_length=3, max_length=7)
    base_time_ms: int = Field(300_000, ge=60_000, le=3_600_000)
    increment_ms: int = Field(0, ge=0, le=60_000)


class PlayerOut(BaseModel):
    seat: int
    kind: str
    user_id: int | None
    bot_key: str | None
    personality_name: str | None
    rating: int
    place: int | None
    eliminated_round: int | None


class GameOut(BaseModel):
    id: int
    round: int
    board: int
    stage: str
    white_seat: int
    black_seat: int
    base_time_ms: int
    increment_ms: int
    result: str | None
    game_id: int | None


class StandingOut(BaseModel):
    seat: int
    points: float
    head_to_head: float
    sonneborn_berger: float
    place: int


class TournamentOut(BaseModel):
    id: int
    format: str
    size: int
    status: str
    base_time_ms: int
    increment_ms: int
    current_round: int
    created_at: str
    finished_at: str | None
    my_seat: int | None
    players: list[PlayerOut]
    games: list[GameOut]
    standings: list[StandingOut]


class TournamentSummary(BaseModel):
    id: int
    format: str
    size: int
    status: str
    created_at: str
    my_place: int | None


def _player(p: TournamentPlayer) -> PlayerOut:
    return PlayerOut(
        seat=p.seat, kind=p.kind, user_id=p.user_id, bot_key=p.bot_key, personality_name=p.personality_name,
        rating=p.rating, place=p.place, eliminated_round=p.eliminated_round,
    )


def _game(g: TournamentGame) -> GameOut:
    return GameOut(
        id=g.id, round=g.round, board=g.board, stage=g.stage, white_seat=g.white_seat, black_seat=g.black_seat,
        base_time_ms=g.base_time_ms, increment_ms=g.increment_ms, result=g.result, game_id=g.game_id,
    )


async def view(db: AsyncSession, tournament: Tournament, user: User) -> TournamentOut:
    players = await service.players_of(db, tournament.id)
    games = await service.games_of(db, tournament.id)
    standings: list[StandingOut] = []
    if tournament.format == "round_robin":
        played = [rules.GameRecord(g.white_seat, g.black_seat, g.result) for g in games if g.result]  # type: ignore[arg-type]
        standings = [StandingOut(**s.__dict__) for s in rules.round_robin_standings([p.seat for p in players], played)]
    return TournamentOut(
        id=tournament.id, format=tournament.format, size=tournament.size, status=tournament.status,
        base_time_ms=tournament.base_time_ms, increment_ms=tournament.increment_ms,
        current_round=tournament.current_round, created_at=tournament.created_at.isoformat(),
        finished_at=tournament.finished_at.isoformat() if tournament.finished_at else None,
        my_seat=next((p.seat for p in players if p.user_id == user.id), None),
        players=[_player(p) for p in players], games=[_game(g) for g in games], standings=standings,
    )


async def owned(db: AsyncSession, tournament_id: int, user: User) -> Tournament:
    tournament = await db.get(Tournament, tournament_id)
    if tournament is None or tournament.owner_id != user.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "tournament_not_found")
    return tournament


@router.post("", response_model=TournamentOut, status_code=status.HTTP_201_CREATED)
async def create_tournament(
        payload: TournamentCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    try:
        tournament = await service.create_tournament(
            db, user, payload.format, payload.size,
            [service.ParticipantSpec(p.kind, p.id) for p in payload.participants],
            payload.base_time_ms, payload.increment_ms,
        )
    except DomainError as exc:
        raise exc.to_http(status.HTTP_409_CONFLICT if exc.code in _CONFLICTS else status.HTTP_400_BAD_REQUEST) from None
    return await view(db, tournament, user)


@router.get("", response_model=list[TournamentSummary])
async def list_tournaments(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(Tournament, TournamentPlayer.place)
        .join(TournamentPlayer, (TournamentPlayer.tournament_id == Tournament.id) & (TournamentPlayer.user_id == user.id))
        .where(Tournament.owner_id == user.id)
        .order_by(Tournament.id.desc())
    )).all()
    return [
        TournamentSummary(id=t.id, format=t.format, size=t.size, status=t.status,
                          created_at=t.created_at.isoformat(), my_place=place)
        for t, place in rows
    ]


@router.get("/{tournament_id}", response_model=TournamentOut)
async def get_tournament(tournament_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await view(db, await owned(db, tournament_id, user), user)

