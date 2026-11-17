# --- FILE: src/api/watch.py ---
"""
«Просмотр» (таск 16.3): архив партий мастеров с фильтрами, «Партия дня» и «забавные подборки». Идущие сейчас партии —
GET /profile/games/live. Фильтры — в SQL: имя игрока, годы (pgn_date начинается с года), код дебюта (eco), результат.
"""

import datetime as dt
import zlib

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.api.rate_limit import rate_limit
from src.db.session import get_db
from src.models.collection import CollectionEntry
from src.models.game import Game, GameStatus
from src.models.user import User
from src.services.collections import COLLECTIONS

router = APIRouter(dependencies=[Depends(rate_limit("watch", "RATE_LIMIT_PUZZLES"))])

ARCHIVE_PASSWORD = "!historical_archive_no_login!"
RESULTS = ("1-0", "0-1", "1/2-1/2")


def _archive_query():
    white, black = aliased(User), aliased(User)
    query = (
        select(Game.id, white.username, black.username, Game.pgn_date, Game.site, Game.result, Game.eco)
        .join(white, white.id == Game.white_player_id).join(black, black.id == Game.black_player_id)
        .where(white.hashed_password == ARCHIVE_PASSWORD, black.hashed_password == ARCHIVE_PASSWORD,
               Game.status == GameStatus.COMPLETED)
    )
    return query, white, black


def _item(row) -> dict:
    gid, white, black, date, site, result, eco = row
    year = (date or "")[:4]
    return {"id": gid, "white": white, "black": black, "year": year if year.isdigit() else None, "site": site,
            "result": result, "eco": eco}


@router.get("/archive")
async def archive(
        player: str | None = Query(None, max_length=60, description="Часть имени игрока (любой цвет)"),
        year_from: int | None = Query(None, ge=1400, le=2100),
        year_to: int | None = Query(None, ge=1400, le=2100),
        eco: str | None = Query(None, pattern=r"^[A-Ea-e](\d{1,2})?$", description="Код или начало кода: C, C6, C60"),
        result: str | None = Query(None, pattern=r"^(1-0|0-1|1/2-1/2)$"),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        db: AsyncSession = Depends(get_db),
):
    """Архив партий мастеров с фильтрами: часть имени игрока, годы, код дебюта и результат; постранично."""
    query, white, black = _archive_query()
    if player:
        pattern = f"%{player.strip().lower()}%"
        query = query.where(or_(func.lower(white.username).like(pattern), func.lower(black.username).like(pattern)))
    if year_from is not None:
        query = query.where(Game.pgn_date >= f"{year_from:04d}")
    if year_to is not None:
        query = query.where(Game.pgn_date < f"{year_to + 1:04d}")
    if eco:
        query = query.where(Game.eco.like(f"{eco.upper()}%"))
    if result:
        query = query.where(Game.result == result)
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = (await db.execute(
        query.order_by(Game.pgn_date.desc().nulls_last(), Game.id.desc()).limit(limit).offset(offset)
    )).all()
    return {"total": total, "items": [_item(r) for r in rows]}


@router.get("/game-of-the-day")
async def game_of_the_day(db: AsyncSession = Depends(get_db)):
    """Одна партия на всех на день: результативная партия архива, выбор — по дате."""
    query, _, _ = _archive_query()
    query = query.where(Game.result.in_(("1-0", "0-1")))
    count = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    if count == 0:
        return {"game": None}
    today = dt.datetime.now(dt.UTC).date()
    offset = zlib.crc32(today.isoformat().encode()) % count
    row = (await db.execute(query.order_by(Game.id).offset(offset).limit(1))).one()
    return {"date": today.isoformat(), "game": _item(row)}


@router.get("/collections")
async def collections(db: AsyncSession = Depends(get_db)):
    """Готовые подборки (scripts/build_collections.py): партии по местам и показатель подборки."""
    query, _, _ = _archive_query()
    sub = query.subquery()
    rows = (await db.execute(
        select(CollectionEntry.collection, CollectionEntry.rank, CollectionEntry.value, *sub.c)
        .join(sub, sub.c.id == CollectionEntry.game_id)
        .order_by(CollectionEntry.collection, CollectionEntry.rank)
    )).all()
    result: dict[str, list[dict]] = {key: [] for key in COLLECTIONS}
    for collection, _, value, *game in rows:
        if collection in result:
            result[collection].append({**_item(game), "value": value})
    return {"collections": result}
