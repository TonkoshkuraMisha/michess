# --- FILE: src/api/personalities.py ---
"""
Мастерская соперников: персоналии, собранные игроком (таск 10.2).

Один источник правды — сервер. Гость хранит персоналии в localStorage браузера, а после входа
переносит их сюда одним запросом POST /bots/personalities/import (дальше они живут только здесь).

Имя персоналии подчиняется правилам имён пользователей: оно попадает в PGN и архив партий,
поэтому имена исторических ботов и чемпионов зарезервированы — нельзя «сыграть с Морфи», которого
на самом деле собрал игрок.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.db.session import get_db
from src.models.personality import BotPersonality
from src.models.user import User
from src.schemas.user import USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, username_key, validate_username
from src.services.bots.personality import BotPersonalityConfig

router = APIRouter()

MAX_PERSONALITIES_PER_USER = 20
LIMIT_DETAIL = f"Не больше {MAX_PERSONALITIES_PER_USER} соперников в мастерской — удалите лишних"
DUPLICATE_DETAIL = "Соперник с таким именем уже есть"
RESERVED_DETAIL = "Это имя занято историческим ботом или чемпионом"
NOT_FOUND_DETAIL = "Соперник не найден"


def is_reserved_personality_name(name: str) -> bool:
    from src.api.auth import _is_reserved

    return _is_reserved(name)


def validate_personality_name(value: str) -> str:
    value = validate_username(value.strip())
    if is_reserved_personality_name(value):
        raise ValueError(RESERVED_DETAIL)
    return value


class PersonalityIn(BaseModel):
    name: str = Field(..., min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    config: BotPersonalityConfig = Field(default_factory=BotPersonalityConfig)

    _check_name = field_validator("name")(validate_personality_name)


class PersonalityUpdate(BaseModel):
    name: str | None = Field(None, min_length=USERNAME_MIN_LENGTH, max_length=USERNAME_MAX_LENGTH)
    config: BotPersonalityConfig | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str | None) -> str | None:
        return None if value is None else validate_personality_name(value)


class PersonalityOut(BaseModel):
    id: int
    name: str
    config: BotPersonalityConfig
    created_at: str
    updated_at: str


class PersonalityImport(BaseModel):
    items: list[PersonalityIn] = Field(..., max_length=MAX_PERSONALITIES_PER_USER)


class SkippedPersonality(BaseModel):
    name: str
    reason: str


class PersonalityImportResult(BaseModel):
    created: list[PersonalityOut]
    skipped: list[SkippedPersonality]


def _out(p: BotPersonality) -> PersonalityOut:
    return PersonalityOut(
        id=p.id,
        name=p.name,
        config=BotPersonalityConfig.model_validate_json(p.config_json),
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


async def _count(db: AsyncSession, owner_id: int) -> int:
    return (await db.execute(
        select(func.count(BotPersonality.id)).where(BotPersonality.owner_id == owner_id)
    )).scalar_one()


async def _name_taken(db: AsyncSession, owner_id: int, name: str, except_id: int | None = None) -> bool:
    query = select(BotPersonality.id).where(
        BotPersonality.owner_id == owner_id, BotPersonality.name_key == username_key(name),
    )
    if except_id is not None:
        query = query.where(BotPersonality.id != except_id)
    return (await db.execute(query)).first() is not None


async def get_owned_personality(db: AsyncSession, owner_id: int, personality_id: int) -> BotPersonality:
    """Персоналия владельца или 404 (чужая неотличима от несуществующей)."""
    personality = await db.get(BotPersonality, personality_id)
    if personality is None or personality.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL)
    return personality


def personality_config(personality: BotPersonality) -> BotPersonalityConfig:
    return BotPersonalityConfig.model_validate_json(personality.config_json)


def _new(owner_id: int, item: PersonalityIn) -> BotPersonality:
    return BotPersonality(
        owner_id=owner_id,
        name=item.name,
        name_key=username_key(item.name),
        config_json=item.config.model_dump_json(),
    )


@router.get("", response_model=list[PersonalityOut])
async def list_personalities(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(BotPersonality).where(BotPersonality.owner_id == user.id).order_by(BotPersonality.id)
    )).scalars().all()
    return [_out(p) for p in rows]


@router.post("", response_model=PersonalityOut, status_code=status.HTTP_201_CREATED)
async def create_personality(
        payload: PersonalityIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if await _count(db, user.id) >= MAX_PERSONALITIES_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=LIMIT_DETAIL)
    if await _name_taken(db, user.id, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_DETAIL)
    personality = _new(user.id, payload)
    db.add(personality)
    try:
        await db.commit()
    except IntegrityError:  # гонка двух одинаковых запросов
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_DETAIL) from None
    await db.refresh(personality)
    return _out(personality)


@router.post("/import", response_model=PersonalityImportResult)
async def import_personalities(
        payload: PersonalityImport, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """
    Перенос гостевых персоналий из localStorage после входа. Совпадающие по имени и не
    поместившиеся в лимит пропускаются с причиной — клиент показывает их игроку.
    """
    free = MAX_PERSONALITIES_PER_USER - await _count(db, user.id)
    created: list[BotPersonality] = []
    skipped: list[SkippedPersonality] = []
    seen: set[str] = set()
    for item in payload.items:
        key = username_key(item.name)
        if key in seen or await _name_taken(db, user.id, item.name):
            skipped.append(SkippedPersonality(name=item.name, reason=DUPLICATE_DETAIL))
            continue
        if len(created) >= free:
            skipped.append(SkippedPersonality(name=item.name, reason=LIMIT_DETAIL))
            continue
        seen.add(key)
        personality = _new(user.id, item)
        db.add(personality)
        created.append(personality)
    await db.commit()
    for personality in created:
        await db.refresh(personality)
    return PersonalityImportResult(created=[_out(p) for p in created], skipped=skipped)


@router.put("/{personality_id}", response_model=PersonalityOut)
async def update_personality(
        personality_id: int,
        payload: PersonalityUpdate,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
):
    personality = await get_owned_personality(db, user.id, personality_id)
    if payload.name is not None:
        if await _name_taken(db, user.id, payload.name, except_id=personality.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_DETAIL)
        personality.name = payload.name
        personality.name_key = username_key(payload.name)
    if payload.config is not None:
        personality.config_json = payload.config.model_dump_json()
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_DETAIL) from None
    await db.refresh(personality)
    return _out(personality)


@router.delete("/{personality_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_personality(
        personality_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    personality = await get_owned_personality(db, user.id, personality_id)
    await db.delete(personality)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = [
    "MAX_PERSONALITIES_PER_USER",
    "get_owned_personality",
    "personality_config",
    "router",
    "validate_personality_name",
]
