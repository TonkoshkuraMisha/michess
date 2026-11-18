"""
Библиотека партий (таски 27.1–27.2): разбор PGN в записи библиотеки, слияние одинаковых партий, дерево коллекций,
видимость и сборка PGN для просмотра.

При импорте берутся только заголовки и главная линия: комментарии, варианты и оценки из файлов отбрасываются
(правило 5, `docs/research/books-library-review.md`). Нелегальный ход обрывает партию на нём, а не импорт.
"""

import hashlib
import io
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import TextIO

import chess
import chess.pgn
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.library import LibraryCollection, LibraryGame, LibraryGameCollection
from src.models.user import User
from src.services import openings, pawn_structures, position_index
from src.services.game_engine import normalize_result

STANDARD_FEN = chess.STARTING_FEN
MAX_PLIES = 1000
YEAR = re.compile(r"^(\d{4})")


@dataclass
class ParsedGame:
    """
    Партия, прочитанная из PGN: поля заголовков, главная линия ходов и её хэш — по нему одинаковые партии из разных
    файлов сливаются.
    """
    white: str
    black: str
    event: str
    site: str
    date: str
    year: int | None
    round: str
    result: str
    white_elo: int | None
    black_elo: int | None
    eco: str
    opening: str
    start_fen: str | None
    moves: list[str]

    @property
    def moves_hash(self) -> str:
        key = "|".join((self.white.lower(), self.black.lower(), str(self.year or ""), self.start_fen or "",
                        " ".join(self.moves)))
        return hashlib.sha256(key.encode("utf-8")).hexdigest()


# Фигурки шрифтов старых шахматных программ в тексте (¢ король … § пешка) — перед полем или взятием.
FIGURINES = {"¢": "K", "£": "Q", "¤": "N", "¥": "B", "¦": "R", "§": "P"}
_FIGURINE = re.compile(r"[¢£¤¥¦§](?=[a-hx])")
_LATIN_HIGH = re.compile(r"[\u00c0-\u00ff]")
_CYRILLIC = re.compile(r"[\u0400-\u04ff]")
_HIGH_WORD = re.compile(r"[\u00c0-\u00ff]{3,}")


def repair_text(value: str) -> str:
    """
    Текст в cp1251, прочитанный как однобайтовая латиница («Ñèöèëèàíñêàÿ» вместо «Сицилианская»), — обратно в
    кириллицу; фигурки шрифта — в буквы ходов. Латиница с диакритикой (Müller, Réti) не трогается: в ней старших
    букв мало, а в кириллице, прочитанной не так, — почти все.
    """
    value = _FIGURINE.sub(lambda m: FIGURINES[m.group(0)], value)
    if _CYRILLIC.search(value):
        return value
    high = len(_LATIN_HIGH.findall(value))
    letters = high + sum(ch.isascii() and ch.isalpha() for ch in value)
    if high >= 2 and high / letters > 0.5:
        return _to_cp1251(value)
    # Латинский префикс разбавляет долю («KID_AverbakhVar-Ñòàðîèíäèéñêàÿ»): слово из трёх и более старших букв
    # подряд в настоящих западных именах не встречается.
    return _HIGH_WORD.sub(lambda m: _to_cp1251(m.group(0)), value)


def _to_cp1251(value: str) -> str:
    for single_byte in ("cp1252", "latin-1"):
        try:
            return value.encode(single_byte).decode("cp1251")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return value


def _header(game: chess.pgn.Game, name: str, limit: int) -> str:
    value = repair_text(game.headers.get(name, "").strip())
    return "" if value in ("?", "????.??.??") else value[:limit]


def _int(value: str) -> int | None:
    value = value.strip()
    return int(value) if value.isdigit() and 0 < int(value) < 4000 else None


def parse_game(game: chess.pgn.Game) -> ParsedGame | None:
    """Партия PGN → запись библиотеки; None — партия без ходов или шахматы другого вида."""
    variant = game.headers.get("Variant", "").lower()
    if variant and variant not in ("standard", "chess"):
        return None
    try:
        board = game.board()
    except ValueError:
        return None
    start_fen = None if board.fen() == STANDARD_FEN else board.fen()
    moves: list[str] = []
    node: chess.pgn.GameNode = game
    while node.variations and len(moves) < MAX_PLIES:
        node = node.variations[0]
        move = node.move
        if move is None or move not in board.legal_moves:
            break
        moves.append(move.uci())
        board.push(move)
    if not moves:
        return None
    date = _header(game, "Date", 10)
    year_match = YEAR.match(date)
    year = int(year_match.group(1)) if year_match and 1400 < int(year_match.group(1)) < 2200 else None
    opening = openings.classify(moves) if start_fen is None else None
    eco = _header(game, "ECO", 3).upper()
    if not re.fullmatch(r"[A-E]\d\d", eco):
        eco = opening.eco if opening else ""
    result = game.headers.get("Result", "*").strip()
    return ParsedGame(
        white=_header(game, "White", 120), black=_header(game, "Black", 120), event=_header(game, "Event", 200),
        site=_header(game, "Site", 200), date=date, year=year, round=_header(game, "Round", 20),
        result=normalize_result(result),
        white_elo=_int(game.headers.get("WhiteElo", "")), black_elo=_int(game.headers.get("BlackElo", "")),
        eco=eco, opening=opening.name[:200] if opening else "", start_fen=start_fen, moves=moves,
    )


def open_pgn(path: str) -> TextIO:
    """Файл PGN в UTF-8 или в cp1251 (старые русские базы): кодировка — по началу файла."""
    with open(path, "rb") as raw:
        head = raw.read(65536)
    try:
        head.decode("utf-8")
        encoding = "utf-8-sig"
    except UnicodeDecodeError as exc:
        # Обрезанный в конце блока многобайтный символ — не повод считать файл не UTF-8.
        encoding = "utf-8-sig" if exc.start >= len(head) - 4 else "cp1251"
    return open(path, encoding=encoding, errors="replace")


def read_games(handle: TextIO) -> Iterator[chess.pgn.Game]:
    while True:
        game = chess.pgn.read_game(handle)
        if game is None:
            return
        yield game


def read_text(text: str) -> Iterator[chess.pgn.Game]:
    return read_games(io.StringIO(text))


@dataclass
class ImportStats:
    """Счётчики импорта: прочитано партий, добавлено, найдено дублей, привязано к коллекции, пропущено."""
    games: int = 0
    added: int = 0
    duplicates: int = 0
    linked: int = 0
    skipped: int = 0

    def __iadd__(self, other: ImportStats) -> ImportStats:
        for name in ("games", "added", "duplicates", "linked", "skipped"):
            setattr(self, name, getattr(self, name) + getattr(other, name))
        return self


async def ensure_collection(db: AsyncSession, path: str, *, visibility: str = "public", owner_id: int | None = None,
                            source: str = "") -> LibraryCollection:
    """Коллекция по пути «A/B/C» со всеми родителями; видимость и владелец — у всех узлов пути."""
    parent: LibraryCollection | None = None
    parts = [part.strip() for part in path.split("/") if part.strip()]
    for depth in range(len(parts)):
        sub = "/".join(parts[:depth + 1])[:500]
        node = await db.scalar(select(LibraryCollection).where(LibraryCollection.path == sub))
        if node is None:
            node = LibraryCollection(path=sub, name=parts[depth][:200], parent_id=parent.id if parent else None)
            db.add(node)
        node.visibility, node.owner_id, node.source = visibility, owner_id, source
        await db.flush()
        parent = node
    if parent is None:
        raise ValueError("empty collection path")
    return parent


async def import_games(db: AsyncSession, collection: LibraryCollection, games: Iterable[chess.pgn.Game],
                       batch: int = 500) -> ImportStats:
    """Партии → библиотека: новые добавляются, одинаковые (по хэшу) только привязываются к коллекции."""
    stats = ImportStats()
    sort = await db.scalar(select(LibraryGameCollection.sort).where(LibraryGameCollection.collection_id == collection.id)
                           .order_by(LibraryGameCollection.sort.desc()).limit(1)) or 0
    pending: list[ParsedGame] = []

    async def flush() -> None:
        """
        Записывает накопленную пачку партий: уже известные (по хэшу ходов) только привязываются к коллекции, новые
        добавляются в библиотеку.
        """
        nonlocal sort
        hashes = {game.moves_hash for game in pending}
        known = dict((await db.execute(
            select(LibraryGame.moves_hash, LibraryGame.id).where(LibraryGame.moves_hash.in_(hashes))
        )).tuples().all())
        linked = set((await db.execute(
            select(LibraryGameCollection.game_id).where(LibraryGameCollection.collection_id == collection.id,
                                                        LibraryGameCollection.game_id.in_(known.values()))
        )).scalars().all()) if known else set()
        for parsed in pending:
            key = parsed.moves_hash
            if key in known:
                stats.duplicates += 1
                game_id = known[key]
            else:
                row = LibraryGame(moves_hash=key, white=parsed.white, black=parsed.black, event=parsed.event,
                                  site=parsed.site, date=parsed.date, year=parsed.year, round=parsed.round,
                                  result=parsed.result, white_elo=parsed.white_elo, black_elo=parsed.black_elo,
                                  eco=parsed.eco, opening=parsed.opening, start_fen=parsed.start_fen,
                                  plies=len(parsed.moves), moves=" ".join(parsed.moves),
                                  structure=structure_of(parsed), mate_finish=ends_in_mate(parsed.start_fen, parsed.moves))
                db.add(row)
                await db.flush()
                # Позиции новой партии — в индекс библиотеки: примеры под позицией в справочнике дебютов (8б).
                await position_index.index_library_game(db, row)
                known[key] = game_id = row.id
                stats.added += 1
            if game_id not in linked:
                sort += 1
                db.add(LibraryGameCollection(collection_id=collection.id, game_id=game_id, sort=sort))
                linked.add(game_id)
                stats.linked += 1
        await db.flush()
        pending.clear()

    for game in games:
        stats.games += 1
        parsed = parse_game(game)
        if parsed is None:
            stats.skipped += 1
            continue
        pending.append(parsed)
        if len(pending) >= batch:
            await flush()
    if pending:
        await flush()
    return stats


def structure_of(parsed: ParsedGame) -> str | None:
    """Пешечная структура партии (27.5) — только из начальной позиции."""
    if parsed.start_fen is not None:
        return None
    return pawn_structures.game_structure(chess.Move.from_uci(uci) for uci in parsed.moves)


def ends_in_mate(start_fen: str | None, moves: list[str]) -> bool:
    """Партия закончилась матом на доске (метка для «Миниатюр», 27.9)."""
    board = chess.Board(start_fen) if start_fen else chess.Board()
    try:
        for uci in moves:
            board.push(chess.Move.from_uci(uci))
    except (ValueError, AssertionError):
        return False
    return board.is_checkmate()


def visible_clause(user: User | None) -> ColumnElement[bool]:
    """Какие коллекции видит пользователь: публичные, свои закрытые, служебные — модераторы."""
    conditions: list[ColumnElement[bool]] = [LibraryCollection.visibility == "public"]
    if user is not None:
        conditions.append((LibraryCollection.visibility == "owner") & (LibraryCollection.owner_id == user.id))
        if user.is_moderator:
            conditions.append(LibraryCollection.visibility == "staff")
    return or_(*conditions)


# Статусы аннотации (таск 27.4): auto и approved видны всем, draft и review — модераторам.
ANNOTATION_STATUSES = ("auto", "draft", "review", "approved")
PUBLIC_ANNOTATION = ("auto", "approved")


def annotation_view(annotation, user: User | None) -> dict | None:
    """Аннотация для просмотра партии — если её можно показать этому пользователю."""
    if annotation is None:
        return None
    if annotation.status not in PUBLIC_ANNOTATION and not (user is not None and user.is_moderator):
        return None
    body = annotation.body or {}
    return {"status": annotation.status, "version": annotation.version, "comments": body.get("comments", {}),
            "evals": body.get("evals", [])}


def to_pgn(game: LibraryGame) -> str:
    """PGN партии библиотеки: заголовки и ходы, без комментариев."""
    pgn = chess.pgn.Game()
    for name, value in (("Event", game.event), ("Site", game.site), ("Date", game.date), ("Round", game.round),
                        ("White", game.white), ("Black", game.black), ("Result", game.result),
                        ("WhiteElo", str(game.white_elo or "")), ("BlackElo", str(game.black_elo or "")),
                        ("ECO", game.eco), ("Opening", game.opening)):
        if value:
            pgn.headers[name] = value
    if game.start_fen:
        pgn.setup(chess.Board(game.start_fen))
    node: chess.pgn.GameNode = pgn
    for uci in game.moves.split():
        node = node.add_variation(chess.Move.from_uci(uci))
    return str(pgn)
