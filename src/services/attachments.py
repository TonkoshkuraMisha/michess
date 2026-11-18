# --- FILE: src/services/attachments.py ---
"""
Карточки-вложения игрока (таски 30.1 и 30.2): партия, позиция, задача, урок, турнир, партия библиотеки — в личных
сообщениях и ленте; своё достижение — только в ленте. Сервер проверяет ссылку и снимает данные на момент отправки (имена,
результат, рейтинг задачи); подписи на трёх языках собирает клиент — строк интерфейса здесь нет.

Партия библиотеки прикладывается, только если лежит в публичной коллекции: материалы с ограниченной видимостью
(свои закрытые, служебные) наружу не уходят, даже если автор сам их видит.

Что проверяется по видам: партия, задача, турнир и партия библиотеки — запись с таким номером есть в базе (games,
puzzles, tournaments, library_games); позиция — FEN читается и позиция возможна; достижение — открыто у самого автора
(user_achievements); урок — только вид идентификатора: уроки лежат в файлах клиента, сервер их не хранит.
Кто вызывает: src/services/direct_messages.py (виды MESSAGE_KINDS) и src/services/feed.py (POST_KINDS).
"""

import re

import chess
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.errors import DomainError
from src.models.achievement import UserAchievement
from src.models.game import Game
from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.puzzle import Puzzle
from src.models.tournament import Tournament
from src.models.user import User

# Виды карточек, которые можно приложить к личному сообщению, и к записи ленты (там ещё своё достижение).
MESSAGE_KINDS = ("game", "position", "puzzle", "lesson", "tournament", "library")
POST_KINDS = (*MESSAGE_KINDS, "achievement")
# Допустимый вид идентификатора урока и кода достижения (до обращения к базе).
LESSON_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
ACHIEVEMENT_CODE = re.compile(r"^[a-z0-9_]{1,32}$")


def clean_text(text: str | None, limit: int) -> str:
    """
    Обрезка краёв и лишних пустых строк; переносы внутри сохраняются. Несколько пустых строк подряд становятся одной,
    пробелы в конце строк убираются, результат обрезается до limit знаков.
    """
    lines = [line.rstrip() for line in (text or "").strip().splitlines()]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out)[:limit]


async def _usernames(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.username).where(User.id.in_(ids)))
    return {uid: name for uid, name in rows.all()}


def _invalid() -> DomainError:
    return DomainError("attachment_invalid")


async def _numeric(db: AsyncSession, kind: str, key: int) -> dict:
    """
    Карточка для видов с номером записи: партия (имена игроков, результат, статус), задача (позиция и рейтинг),
    партия библиотеки (только из публичной коллекции) и турнир с ботами (формат, размер, статус, владелец). Записи
    нет — attachment_invalid.
    """
    if kind == "game":
        game = await db.get(Game, key)
        if game is None:
            raise _invalid()
        names = await _usernames(db, {game.white_player_id, game.black_player_id})
        return {"kind": kind, "ref": str(game.id), "white": names.get(game.white_player_id),
                "black": names.get(game.black_player_id), "result": game.result,
                "status": game.status.value if hasattr(game.status, "value") else str(game.status)}
    if kind == "puzzle":
        puzzle = await db.get(Puzzle, key)
        if puzzle is None:
            raise _invalid()
        return {"kind": kind, "ref": str(puzzle.id), "fen": puzzle.fen, "rating": puzzle.rating}
    if kind == "library":
        public = exists().where(LibraryGameCollection.game_id == LibraryGame.id,
                                LibraryGameCollection.collection_id == LibraryCollection.id,
                                LibraryCollection.visibility == "public")
        item = await db.scalar(select(LibraryGame).where(LibraryGame.id == key, public))
        if item is None:
            raise _invalid()
        return {"kind": kind, "ref": str(item.id), "white": item.white, "black": item.black,
                "result": item.result, "year": item.year, "event": item.event}
    tournament = await db.get(Tournament, key)
    if tournament is None:
        raise _invalid()
    owner = (await _usernames(db, {tournament.owner_id})).get(tournament.owner_id)
    return {"kind": kind, "ref": str(tournament.id), "format": tournament.format, "size": tournament.size,
            "status": tournament.status, "owner": owner, "event_key": tournament.event_key,
            "career_stage": tournament.career_stage}


async def build_attachment(db: AsyncSession, kind: str, ref: str, *, author: User,
                           kinds: tuple[str, ...] = MESSAGE_KINDS) -> dict:
    """
    Проверяет ссылку и снимает карточку. Ошибка — attachment_invalid. kind — вид карточки (должен входить в kinds),
    ref — номер записи, FEN позиции, идентификатор урока или код достижения (не длиннее 100 знаков); author нужен
    только достижению: приложить можно лишь своё. Возвращает словарь с "kind", "ref" и снимком данных — он
    сохраняется вместе с сообщением и позже не обновляется.
    """
    ref = (ref or "").strip()
    if kind not in kinds or not ref or len(ref) > 100:
        raise _invalid()
    if kind in ("game", "puzzle", "tournament", "library"):
        if not ref.isdigit():
            raise _invalid()
        return await _numeric(db, kind, int(ref))
    if kind == "position":
        try:
            board = chess.Board(ref)
        except ValueError:
            raise _invalid() from None
        if not board.is_valid():
            raise _invalid()
        return {"kind": kind, "ref": board.fen()}
    if kind == "achievement":
        earned = await db.scalar(select(UserAchievement.earned_at).where(
            UserAchievement.user_id == author.id, UserAchievement.code == ref)) if ACHIEVEMENT_CODE.match(ref) else None
        if earned is None:
            raise _invalid()
        return {"kind": kind, "ref": ref, "earned_at": earned.isoformat()}
    if not LESSON_ID.match(ref):
        raise _invalid()
    return {"kind": kind, "ref": ref}
