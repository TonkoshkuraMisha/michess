"""
Дебютный репертуар (таск 20.1): свои репертуары за белых и за чёрных, шесть стартовых наборов, добавление линий
(из справочника дебютов, из просмотра партии — линией UCI; из текста PGN), комментарии к ходам и удаление хода
вместе с ветками, которые после него стали недостижимы.
"""

from typing import Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError
from src.db.session import get_db
from src.models.repertoire import Repertoire, RepertoireMove
from src.models.user import User
from src.services import repertoire as service
from src.services.repertoire_starters import BY_ID, STARTERS

router = APIRouter(dependencies=[Depends(rate_limit("repertoire", "RATE_LIMIT_PUZZLES"))])

RepertoireId = Path(..., ge=1)


class CreateIn(BaseModel):
    name: str = Field("", max_length=80)
    color: Literal["white", "black"] = "white"
    starter: str | None = Field(None, max_length=32)


class RenameIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class LineIn(BaseModel):
    moves: list[str] = Field(..., min_length=1, max_length=service.MAX_LINE_PLIES)


class PgnIn(BaseModel):
    pgn: str = Field(..., min_length=1, max_length=service.MAX_PGN_CHARS)


class MoveRef(BaseModel):
    position: str = Field(..., max_length=100)
    uci: str = Field(..., max_length=5)


class CommentIn(MoveRef):
    comment: str = Field("", max_length=service.MAX_COMMENT)


def _http(exc: DomainError) -> ApiError:
    status = 404 if exc.code == "repertoire_move_not_found" else 400
    return ApiError(status, exc.code, **exc.params)


async def _own(db: AsyncSession, repertoire_id: int, user: User) -> Repertoire:
    repertoire = await db.get(Repertoire, repertoire_id)
    if repertoire is None or repertoire.user_id != user.id:
        raise ApiError(404, "repertoire_not_found")
    return repertoire


async def _full(db: AsyncSession, repertoire: Repertoire) -> dict:
    edges = service.build_tree(repertoire.color, await service.load_moves(db, repertoire.id))
    return {
        "id": repertoire.id, "name": repertoire.name, "color": repertoire.color, "starter": repertoire.starter,
        "root": service.ROOT,
        "moves": [{"position": e.position, "uci": e.uci, "san": e.san, "child": e.child, "comment": e.comment,
                   "mine": e.mine} for e in edges],
    }


@router.get("/starters")
async def starters():
    """Стартовые репертуары: коды, сторона и уровень; названия и вводные тексты — на клиенте."""
    return {"starters": [
        {"id": s.id, "color": s.color, "level": s.level, "lines": [service.san_line_to_uci(line) for line in s.lines]}
        for s in STARTERS
    ]}


@router.get("")
async def list_repertoires(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(Repertoire, func.count(RepertoireMove.id))
        .outerjoin(RepertoireMove, RepertoireMove.repertoire_id == Repertoire.id)
        .where(Repertoire.user_id == user.id).group_by(Repertoire.id).order_by(Repertoire.id)
    )).all()
    return {"repertoires": [{"id": r.id, "name": r.name, "color": r.color, "starter": r.starter, "moves": count}
                            for r, count in rows]}


@router.post("")
async def create(payload: CreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Новый репертуар: пустой или копия стартового (тогда сторона берётся из него)."""
    starter = None
    if payload.starter is not None:
        starter = BY_ID.get(payload.starter)
        if starter is None:
            raise ApiError(404, "repertoire_starter_not_found")
    total = await db.scalar(select(func.count()).select_from(Repertoire).where(Repertoire.user_id == user.id)) or 0
    if total >= service.MAX_REPERTOIRES:
        raise ApiError(400, "repertoire_limit", limit=service.MAX_REPERTOIRES)
    repertoire = Repertoire(user_id=user.id, name=payload.name.strip(),
                            color=starter.color if starter else payload.color,
                            starter=starter.id if starter else None)
    db.add(repertoire)
    await db.flush()
    if starter:
        await service.add_lines(db, repertoire, service.starter_lines(starter))
    await db.commit()
    return await _full(db, repertoire)


@router.get("/{repertoire_id}")
async def get_repertoire(repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    return await _full(db, await _own(db, repertoire_id, user))


@router.patch("/{repertoire_id}")
async def rename(payload: RenameIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    repertoire = await _own(db, repertoire_id, user)
    repertoire.name = payload.name.strip()
    await db.commit()
    return {"id": repertoire.id, "name": repertoire.name}


@router.delete("/{repertoire_id}")
async def remove(repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    repertoire = await _own(db, repertoire_id, user)
    await db.execute(delete(RepertoireMove).where(RepertoireMove.repertoire_id == repertoire.id))
    await db.delete(repertoire)
    await db.commit()
    return {"deleted": True}


async def _add(db: AsyncSession, repertoire: Repertoire, lines: list[list[str]]) -> dict:
    try:
        added = await service.add_lines(db, repertoire, lines)
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return {"added": added, **await _full(db, repertoire)}


@router.post("/{repertoire_id}/lines")
async def add_line(payload: LineIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Линия UCI из начальной позиции — из справочника дебютов, из просмотра партии или с доски редактора."""
    return await _add(db, await _own(db, repertoire_id, user), [payload.moves])


@router.post("/{repertoire_id}/pgn")
async def import_pgn(payload: PgnIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    repertoire = await _own(db, repertoire_id, user)
    try:
        lines = service.pgn_lines(payload.pgn)
    except DomainError as exc:
        raise _http(exc) from None
    return await _add(db, repertoire, lines)


@router.put("/{repertoire_id}/comment")
async def set_comment(payload: CommentIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    repertoire = await _own(db, repertoire_id, user)
    row = await db.scalar(select(RepertoireMove).where(
        RepertoireMove.repertoire_id == repertoire.id, RepertoireMove.position == payload.position,
        RepertoireMove.move_uci == payload.uci))
    if row is None:
        raise ApiError(404, "repertoire_move_not_found")
    row.comment = payload.comment.strip()
    await db.commit()
    return {"comment": row.comment}


@router.post("/{repertoire_id}/remove")
async def remove_move(payload: MoveRef, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Убрать ход и ветки за ним (кроме тех, куда можно прийти перестановкой ходов)."""
    repertoire = await _own(db, repertoire_id, user)
    try:
        removed = await service.remove_move(db, repertoire, payload.position, payload.uci)
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return {"removed": removed, **await _full(db, repertoire)}
