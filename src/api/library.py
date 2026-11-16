"""
Библиотека партий (таск 27.1): дерево коллекций, партии коллекции, поиск и партия для просмотра. Без входа видны
только публичные коллекции; свои закрытые — владельцу, служебные — модераторам. Движок не вызывается.
"""

import random

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import user_from_token
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError
from src.db.session import get_db
from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.user import User
from src.services import library, pawn_structures
from src.services import structure_quiz as structure_quiz_service

router = APIRouter(dependencies=[Depends(rate_limit("library", "RATE_LIMIT_PUZZLES"))])

PAGE = 50
RESULTS = ("1-0", "0-1", "1/2-1/2")


async def optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return await user_from_token(db, token)


def _row(game: LibraryGame) -> dict:
    return {"id": game.id, "white": game.white, "black": game.black, "event": game.event, "site": game.site,
            "date": game.date, "year": game.year, "result": game.result, "eco": game.eco, "opening": game.opening,
            "plies": game.plies, "structure": game.structure}


def _visible_game(user: User | None):
    """Партия видна, если лежит хотя бы в одной видимой коллекции."""
    return exists().where(
        LibraryGameCollection.game_id == LibraryGame.id,
        LibraryGameCollection.collection_id == LibraryCollection.id,
        library.visible_clause(user),
    )


async def _visible_game_or_404(db: AsyncSession, game_id: int, user: User | None) -> LibraryGame:
    game = await db.scalar(select(LibraryGame).where(LibraryGame.id == game_id, _visible_game(user)))
    if game is None:
        raise ApiError(404, "library_game_not_found")
    return game


@router.get("/collections")
async def collections(db: AsyncSession = Depends(get_db), user: User | None = Depends(optional_user)):
    """Видимые коллекции плоским списком (дерево собирает клиент по parent_id) с числом своих партий."""
    counts = (select(LibraryGameCollection.collection_id, func.count().label("n"))
              .group_by(LibraryGameCollection.collection_id).subquery())
    rows = (await db.execute(
        select(LibraryCollection, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.collection_id == LibraryCollection.id)
        .where(library.visible_clause(user))
        .order_by(LibraryCollection.sort, LibraryCollection.name)
    )).all()
    return {"collections": [{"id": c.id, "parent_id": c.parent_id, "name": c.name, "visibility": c.visibility,
                             "games": n} for c, n in rows]}


@router.get("/collections/{collection_id}/games")
async def collection_games(collection_id: int = Path(..., ge=1), offset: int = Query(0, ge=0),
                           limit: int = Query(PAGE, ge=1, le=200), db: AsyncSession = Depends(get_db),
                           user: User | None = Depends(optional_user)):
    collection = await db.scalar(select(LibraryCollection).where(LibraryCollection.id == collection_id,
                                                                 library.visible_clause(user)))
    if collection is None:
        raise ApiError(404, "library_collection_not_found")
    total = await db.scalar(select(func.count()).select_from(LibraryGameCollection)
                            .where(LibraryGameCollection.collection_id == collection.id)) or 0
    games = (await db.execute(
        select(LibraryGame).join(LibraryGameCollection, LibraryGameCollection.game_id == LibraryGame.id)
        .where(LibraryGameCollection.collection_id == collection.id)
        .order_by(LibraryGameCollection.sort, LibraryGame.id).offset(offset).limit(limit)
    )).scalars().all()
    return {"id": collection.id, "name": collection.name, "total": total, "games": [_row(g) for g in games]}


@router.get("/games")
async def search(player: str = Query("", max_length=60), eco: str = Query("", max_length=3),
                 year_from: int | None = Query(None, ge=1400, le=2200), year_to: int | None = Query(None, ge=1400, le=2200),
                 result: str = Query("", max_length=7), max_plies: int | None = Query(None, ge=1, le=1000),
                 structure: str = Query("", max_length=20),
                 offset: int = Query(0, ge=0), limit: int = Query(PAGE, ge=1, le=200),
                 db: AsyncSession = Depends(get_db), user: User | None = Depends(optional_user)):
    """Поиск по видимым партиям: игрок (часть имени), код дебюта (начало), годы, результат, длина."""
    conditions = [_visible_game(user)]
    if player.strip():
        pattern = f"%{player.strip().lower()}%"
        conditions.append(func.lower(LibraryGame.white).like(pattern) | func.lower(LibraryGame.black).like(pattern))
    if eco.strip():
        conditions.append(LibraryGame.eco.like(f"{eco.strip().upper()}%"))
    if year_from is not None:
        conditions.append(LibraryGame.year >= year_from)
    if year_to is not None:
        conditions.append(LibraryGame.year <= year_to)
    if result in RESULTS:
        conditions.append(LibraryGame.result == result)
    if max_plies is not None:
        conditions.append(LibraryGame.plies <= max_plies)
    if structure in pawn_structures.STRUCTURES:
        conditions.append(LibraryGame.structure == structure)
    total = await db.scalar(select(func.count()).select_from(LibraryGame).where(*conditions)) or 0
    games = (await db.execute(
        select(LibraryGame).where(*conditions)
        .order_by(LibraryGame.year.desc().nulls_last(), LibraryGame.id).offset(offset).limit(limit)
    )).scalars().all()
    return {"total": total, "games": [_row(g) for g in games]}


@router.get("/structure-quiz")
async def structure_quiz(count: int = Query(10, ge=1, le=20), seed: int | None = Query(None),
                         db: AsyncSession = Depends(get_db)):
    """«Узнай структуру» (27.9): позиции из публичных размеченных партий, недостающее — учебные скелеты."""
    rng = random.Random(seed)
    rows = (await db.execute(
        select(LibraryGame.id, LibraryGame.structure, LibraryGame.moves)
        .where(LibraryGame.structure.is_not(None), LibraryGame.start_fen.is_(None), _visible_game(None))
        .order_by(func.random()).limit(count * 4)
    )).all()
    questions = structure_quiz_service.build([(r[0], r[1], r[2]) for r in rows], count, rng)
    return {"questions": [{"fen": q.fen, "answer": q.answer, "options": q.options, "game_id": q.game_id, "ply": q.ply}
                          for q in questions]}


@router.get("/games/{game_id}")
async def game(game_id: int = Path(..., ge=1), db: AsyncSession = Depends(get_db),
               user: User | None = Depends(optional_user)):
    found = await _visible_game_or_404(db, game_id, user)
    in_collections = (await db.execute(
        select(LibraryCollection.id, LibraryCollection.name)
        .join(LibraryGameCollection, LibraryGameCollection.collection_id == LibraryCollection.id)
        .where(LibraryGameCollection.game_id == found.id, library.visible_clause(user))
        .order_by(LibraryCollection.path)
    )).all()
    return {**_row(found), "start_fen": found.start_fen, "moves": found.moves.split(),
            "collections": [{"id": cid, "name": name} for cid, name in in_collections]}


@router.get("/games/{game_id}/pgn")
async def game_pgn(game_id: int = Path(..., ge=1), db: AsyncSession = Depends(get_db),
                   user: User | None = Depends(optional_user)):
    found = await _visible_game_or_404(db, game_id, user)
    return PlainTextResponse(library.to_pgn(found), media_type="application/x-chess-pgn", headers={
        "Content-Disposition": f"attachment; filename=michess_library_{found.id}.pgn"})
