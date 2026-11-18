# --- FILE: src/services/opening_explorer.py ---
"""
Справочник дебютов (таск 16.2): ходы из позиции со статистикой по индексу позиций (таск 16.1), название дебюта
(src/services/openings.py) и партии мастеров, прошедшие через позицию: из архива чемпионов и из публичных коллекций
библиотеки (8б, решение владельца 18.11).

Повторы архива и библиотеки (одна и та же партия часто есть в обоих местах): две партии под одной позицией считаются
одной, если у них совпадают фамилии обоих игроков и год. Остаётся партия библиотеки — у неё разметка и объяснения;
архивная убирается. В статистику ходов партии библиотеки не входят вовсе (position_stats — только партии сайта и
архива), поэтому дважды партия не посчитается.

Данные: статистика ходов — таблица position_stats, партии через позицию — position_games (обе заполняет
src/services/position_index.py по первым 30 полуходам каждой законченной партии, поэтому глубже статистики нет);
сами партии и имена игроков — games и users. Партии библиотеки — position_library_games и library_games, видимость —
коллекции (library_collections.visibility = public). Названия дебютов — src/services/data/openings.tsv.
"""

import chess
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.core.errors import DomainValueError
from src.models.game import Game
from src.models.library import LibraryAnnotation, LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.position import PositionGame, PositionLibraryGame
from src.models.user import User
from src.services import library, openings, position_index

# Признак игрока исторического архива: загрузчик архива (src/db/seed.py) записывает эту строку вместо хэша пароля,
# войти под таким игроком нельзя. Та же строка продублирована в src/api/social.py и src/api/watch.py.
ARCHIVE_PASSWORD = "!historical_archive_no_login!"
MAX_MOVES = 60  # сколько полуходов запроса учитывается; остальные молча отбрасываются
MASTER_GAMES = 12  # сколько партий мастеров (архив и библиотека вместе) показывается под позицией


def board_after(moves_uci: list[str]) -> tuple[chess.Board, list[chess.Move]]:
    """
    Доска после списка ходов UCI от начальной позиции (учитывается не больше MAX_MOVES полуходов); нелегальный
    ход — отказ illegal_move.
    """
    board = chess.Board()
    played = []
    for uci in moves_uci[:MAX_MOVES]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise DomainValueError("illegal_move", move=uci) from None
        if move not in board.legal_moves:
            raise DomainValueError("illegal_move", move=uci)
        board.push(move)
        played.append(move)
    return board, played


async def master_games(db: AsyncSession, board: chess.Board, limit: int = MASTER_GAMES) -> list[dict]:
    """
    Архивные партии (оба игрока — из архива), проходившие через позицию: новые по дате — первыми, без даты — в
    конце. Позиция ищется по хэшу position_index.position_key; год — первые четыре знака даты из PGN.
    """
    white, black = aliased(User), aliased(User)
    rows = (await db.execute(
        select(Game.id, white.username, black.username, Game.pgn_date, Game.result, Game.eco)
        .join(PositionGame, PositionGame.game_id == Game.id)
        .join(white, white.id == Game.white_player_id).join(black, black.id == Game.black_player_id)
        .where(PositionGame.position_hash == position_index.position_key(board),
               white.hashed_password == ARCHIVE_PASSWORD, black.hashed_password == ARCHIVE_PASSWORD)
        .order_by(Game.pgn_date.desc().nulls_last(), Game.id.desc()).limit(limit)
    )).all()
    return [
        {"id": gid, "white": w, "black": b, "year": (date or "")[:4] or None, "result": result, "eco": eco,
         "source": "archive"}
        for gid, w, b, date, result, eco in rows
    ]


def player_key(name: str) -> str:
    """
    Фамилия игрока для сравнения партий архива и библиотеки: часть до запятой («Lasker, Emanuel» → lasker), иначе
    последнее слово; только буквы в нижнем регистре. Пустое имя — пустая строка (такая партия ни с чем не совпадёт).
    """
    if "," in name:
        base = name.split(",")[0]
    else:
        words = name.split()
        base = words[-1] if words else ""
    return "".join(ch for ch in base.lower() if ch.isalpha())


def _same_game(game: dict) -> tuple[str, str, str] | None:
    """Признак «та же партия»: фамилии обоих игроков и год; без года или имени сравнивать нечего."""
    white, black, year = player_key(game["white"]), player_key(game["black"]), game.get("year")
    return (white, black, str(year)) if white and black and year else None


def merge_examples(archive: list[dict], library: list[dict], limit: int = MASTER_GAMES) -> list[dict]:
    """
    Партии под позицией из архива и библиотеки одним списком: повтор архивной партии в библиотеке (те же фамилии и
    год — обе уже прошли через эту позицию) убирается из архива. Сортировка — новые по году первыми, без года — в
    конце; при равном годе партия библиотеки выше.
    """
    in_library = {key for key in map(_same_game, library) if key}
    merged = [*library, *(g for g in archive if _same_game(g) not in in_library)]
    merged.sort(key=lambda g: (-int(g["year"]) if g.get("year") else 1, g["source"] != "library"))
    return merged[:limit]


async def library_games(db: AsyncSession, board: chess.Board, limit: int = MASTER_GAMES) -> list[dict]:
    """
    Партии публичных коллекций библиотеки, проходившие через позицию (position_library_games): новые по году —
    первыми. annotated — у партии есть объяснения, видимые игроку (library_annotations).
    """
    public = exists().where(
        LibraryGameCollection.game_id == LibraryGame.id,
        LibraryCollection.id == LibraryGameCollection.collection_id,
        LibraryCollection.visibility == "public",
    )
    # Объяснения, которые видит игрок: те же статусы, что показывает просмотр партии (library.PUBLIC_ANNOTATION).
    annotated = exists().where(LibraryAnnotation.game_id == LibraryGame.id,
                               LibraryAnnotation.status.in_(library.PUBLIC_ANNOTATION))
    rows = (await db.execute(
        select(LibraryGame.id, LibraryGame.white, LibraryGame.black, LibraryGame.year, LibraryGame.result,
               LibraryGame.eco, annotated)
        .join(PositionLibraryGame, PositionLibraryGame.library_game_id == LibraryGame.id)
        .where(PositionLibraryGame.position_hash == position_index.position_key(board), public)
        .order_by(LibraryGame.year.desc().nulls_last(), LibraryGame.id.desc()).limit(limit)
    )).all()
    return [
        {"id": gid, "white": w, "black": b, "year": str(year) if year else None, "result": result, "eco": eco or None,
         "source": "library", "annotated": bool(has_notes)}
        for gid, w, b, year, result, eco, has_notes in rows
    ]


async def explore(db: AsyncSession, moves_uci: list[str]) -> dict:
    """
    Справочник по позиции: название дебюта, ходы из позиции со статистикой партий (индекс позиций) и партии мастеров,
    прошедшие через неё (архив и библиотека без повторов — merge_examples). У хода дебют указывается, только если
    после него название меняется.
    """
    board, played = board_after(moves_uci)
    opening = openings.classify_board_line(chess.Board(), played)
    stats = await position_index.moves_from(db, board)
    moves = []
    for stat in stats:
        move = chess.Move.from_uci(stat.move_uci)
        if move not in board.legal_moves:
            continue  # коллизия хэша — такого хода в позиции нет
        after = openings.classify_board_line(chess.Board(), [*played, move])
        moves.append({
            "uci": stat.move_uci, "san": board.san(move), "games": stat.games, "white_wins": stat.white_wins,
            "draws": stat.draws, "black_wins": stat.black_wins,
            "opening": {"eco": after.eco, "name": after.name} if after and after != opening else None,
        })
    return {
        "fen": board.fen(),
        "opening": {"eco": opening.eco, "name": opening.name} if opening else None,
        "moves": moves,
        "games": merge_examples(await master_games(db, board), await library_games(db, board)),
    }
