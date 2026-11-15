"""
Дебютный репертуар (таск 20.1): свои репертуары за белых и за чёрных, шесть стартовых наборов, добавление линий
(из справочника дебютов, из просмотра партии — линией UCI; из текста PGN), комментарии к ходам и удаление хода
вместе с ветками, которые после него стали недостижимы. Повторение и игра против репертуара (таск 20.2) — в конце
файла: карточки по SM-2 и ответы соперника по популярности ходов у людей.
"""

import io
from typing import Literal

import chess
import chess.pgn
from fastapi import APIRouter, Depends, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.api.fair_play import forbid_engine_help_during_game
from src.api.rate_limit import rate_limit
from src.core.errors import ApiError, DomainError
from src.db.session import get_db
from src.models.game import Game, GameStatus
from src.models.repertoire import Repertoire, RepertoireCard, RepertoireMove
from src.models.user import User
from src.services import repertoire as service
from src.services import repertoire_deviations as deviations
from src.services import repertoire_drill as drill
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
    await db.execute(delete(RepertoireCard).where(RepertoireCard.repertoire_id == repertoire.id))
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


class OpponentIn(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=service.MAX_LINE_PLIES)  # пусто — первый ход белых


class AnswerIn(BaseModel):
    position: str = Field(..., max_length=100)
    uci: str = Field(..., max_length=5)
    retry: bool = False


@router.get("/{repertoire_id}/drill")
async def drill_session(repertoire_id: int = RepertoireId, mode: Literal["review", "learn"] = Query("review"),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Карточки сессии: review — по расписанию и новые в пределах дневной нормы, learn — новые линии."""
    result = await drill.session(db, await _own(db, repertoire_id, user), mode, drill.utcnow())
    await db.commit()
    return result


@router.post("/{repertoire_id}/drill/answer")
async def drill_answer(payload: AnswerIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Ответ на карточку; retry — повтор после ошибки в той же сессии, расписание не меняет."""
    repertoire = await _own(db, repertoire_id, user)
    try:
        result = await drill.answer(db, repertoire, payload.position, payload.uci, payload.retry, drill.utcnow())
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return result


@router.post("/{repertoire_id}/opponent", dependencies=[Depends(forbid_engine_help_during_game)])
async def opponent(payload: OpponentIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """«Игра против репертуара»: ответ соперника после линии игрока (статистика ходов — как у справочника)."""
    repertoire = await _own(db, repertoire_id, user)
    try:
        return await drill.opponent_reply(db, repertoire, payload.moves)
    except DomainError as exc:
        raise _http(exc) from None


class FocusIn(BaseModel):
    position: str = Field(..., max_length=100)


@router.post("/{repertoire_id}/drill/focus")
async def drill_focus(payload: FocusIn, repertoire_id: int = RepertoireId, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Карточка позиции — в сегодняшнее повторение (кнопка «Потренировать» после партии, таск 20.3)."""
    repertoire = await _own(db, repertoire_id, user)
    try:
        await drill.focus(db, repertoire, payload.position, drill.utcnow())
    except DomainError as exc:
        raise _http(exc) from None
    await db.commit()
    return {"ok": True}


def _game_moves(game: Game) -> list[chess.Move]:
    """Главная линия законченной партии из начальной позиции; партии с особой расстановкой не сверяются."""
    parsed = chess.pgn.read_game(io.StringIO(game.pgn or ""))
    if parsed is None or parsed.board().fen() != chess.STARTING_FEN:
        return []
    return list(parsed.mainline_moves())


@router.get("/game/{game_id}/deviations")
async def game_deviations(game_id: int = Path(..., ge=1), db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Где сыгранная партия ушла из репертуаров игрока её цвета (таск 20.3). Только свои законченные партии."""
    game = await db.get(Game, game_id)
    player = game is not None and user.id in (game.white_player_id, game.black_player_id)
    if game is None or not player or game.status != GameStatus.COMPLETED:
        raise ApiError(404, "game_not_found", game_id=game_id)
    color = "white" if game.white_player_id == user.id else "black"
    moves = _game_moves(game)
    repertoires = (await db.execute(
        select(Repertoire).where(Repertoire.user_id == user.id, Repertoire.color == color).order_by(Repertoire.id)
    )).scalars().all()
    results: list[dict] = []
    for repertoire in repertoires:
        edges = service.build_tree(repertoire.color, await service.load_moves(db, repertoire.id))
        found = deviations.find(repertoire, edges, moves)
        if found is None:
            continue
        results.append({"repertoire_id": repertoire.id, "name": repertoire.name, "starter": repertoire.starter,
                        "kind": found.kind, "ply": found.ply, "played": found.played, "played_uci": found.played_uci,
                        "expected": found.expected,
                        "line": found.line, "position": found.position})
    results.sort(key=lambda r: -int(r["ply"]))
    return {"color": color, "results": results}
