# --- FILE: src/api/ladder.py ---
"""Клубная лестница: прогресс игрока и начало партии со следующим соперником (src/services/ladder.py)."""

import random
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import _optional_user_id
from src.db.session import get_db
from src.models.user import User
from src.services import ladder
from src.services.bots.personality import BotPersonalityConfig

router = APIRouter()


class RungOut(BaseModel):
    key: str
    kind: str
    id: str
    rating: int
    measured: bool
    status: Literal["beaten", "current", "locked"]


class LadderState(BaseModel):
    rating: int
    games: int
    step: int
    total: int
    rungs: list[RungOut]
    active_opponent: str | None


class LadderStartRequest(BaseModel):
    color: Literal["white", "black", "random"] = "random"


class LadderOpponent(BaseModel):
    """Соперник ступени: имя и описание на языке игрока клиент берёт из каталога по id."""
    key: str
    kind: str
    id: str
    rating: int
    bot_id: str | None = None
    config: BotPersonalityConfig | None = None


class LadderStartResponse(BaseModel):
    opponent: LadderOpponent
    color: Literal["white", "black"]
    step: int
    forfeited: ladder.LadderOutcome | None = None


def _state(user: User, active: str | None) -> LadderState:
    items = ladder.rungs()
    step = min(user.ladder_step, len(items) - 1)
    return LadderState(
        rating=user.ladder_rating,
        games=user.ladder_games,
        step=user.ladder_step,
        total=len(items),
        rungs=[
            RungOut(
                key=r.key, kind=r.kind, id=r.id, rating=r.rating, measured=r.measured,
                status="beaten" if i < user.ladder_step else "current" if i == step else "locked",
            )
            for i, r in enumerate(items)
        ],
        active_opponent=active,
    )


async def note_ladder_analysis(request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """Зависимость эндпоинтов анализа: во время партии лестницы анализ — подсказка."""
    await ladder.note_analysis(await _optional_user_id(request, db))


@router.get("", response_model=LadderState)
async def get_ladder(user: User = Depends(get_current_user)):
    session = await ladder.get_session(user.id)
    return _state(user, session.rung_key if session else None)


@router.post("/start", response_model=LadderStartResponse)
async def start_ladder_game(
        payload: LadderStartRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Открывает партию со следующим соперником. Брошенная начатая партия засчитывается поражением."""
    forfeited = None
    previous = await ladder.get_session(user.id)
    if previous is not None and previous.max_ply >= 0:
        found = ladder.find_rung(previous.rung_key)
        if found is not None:
            forfeited = ladder.apply_result(user, *found, score=0.0, assisted=previous.assisted)
            await db.commit()

    index, rung = ladder.current_rung(user)
    color = payload.color if payload.color != "random" else random.choice(("white", "black"))
    await ladder.open_session(user.id, rung, color)
    archetype = ladder.archetype_for(rung)
    return LadderStartResponse(
        opponent=LadderOpponent(
            key=rung.key, kind=rung.kind, id=rung.id, rating=rung.rating,
            bot_id=rung.key if rung.kind == "historical" else None,
            config=archetype.config if archetype else None,
        ),
        color=color,
        step=index,
        forfeited=forfeited,
    )
