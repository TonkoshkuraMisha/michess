"""Ежедневная разминка (таск 22.2): план на сегодня и серия дней — по самим тренировкам игрока."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.db.session import get_db
from src.models.user import User
from src.services import workout

router = APIRouter()


@router.get("")
async def today(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await workout.plan(db, user, workout.utcnow())
