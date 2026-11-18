# --- FILE: src/api/conferences.py ---
"""
Конференции (таск 33.6): Кубок конференций за сезон, страна игрока в профиле. Правила и таблица стран —
src/services/conferences.py.
"""

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import optional_user_id
from src.core.errors import DomainError
from src.db.session import get_db
from src.models.user import User
from src.services import arena as arena_service
from src.services import conferences as service
from src.services.arena_schedule import CONFERENCE_ZONES

router = APIRouter()

SEASON = r"^\d{4}-(0[1-9]|1[0-2])$"
_CODES = {"country_unknown": status.HTTP_400_BAD_REQUEST}


class CountryIn(BaseModel):
    """Страна для профиля. Сервер адрес игрока для этого не использует — страну игрок указывает сам."""
    # Код страны ISO 3166-1 alpha-2; null — убрать страну из профиля.
    country: str | None = Field(None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")


@router.get("")
async def conferences_page(request: Request, season: str | None = Query(None, pattern=SEASON),
                           db: AsyncSession = Depends(get_db)):
    """
    Кубок конференций за сезон (по умолчанию — текущий месяц), матчи конференций сезона и ближайшие, таблица
    «страна → конференция» для выбора в профиле и — вошедшему игроку — его страна и конференция. suggested_country —
    страна, названная прокси (только подсказка): берётся из заголовка, заданного настройкой
    COUNTRY_HEADER; пока настройка пуста, подсказки нет. Открыто всем.
    """
    user_id = await optional_user_id(request, db)
    user = await db.get(User, user_id) if user_id is not None else None
    await arena_service.ensure_schedule(db)  # ближайший матч конференций создаётся заранее — для записи
    return {
        **await service.cup(db, season),
        "matches": await service.matches(db, season),
        "conferences": [{"key": key, "timezone": zone} for key, zone in CONFERENCE_ZONES.items()],
        "countries": service.CONFERENCE_OF,
        "suggested_country": service.suggested_country(request.headers),
        "me": service.membership(user) if user else None,
    }


@router.put("/me")
async def set_my_country(payload: CountryIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """
    Страна в своём профиле (users.country): от неё зависит конференция. Сменить конференцию можно один раз за
    сезон — иначе 409 country_change_too_soon; неизвестный код страны — 400.
    """
    try:
        return await service.set_country(db, user, payload.country)
    except DomainError as exc:
        raise exc.to_http(_CODES.get(exc.code, status.HTTP_409_CONFLICT)) from None
