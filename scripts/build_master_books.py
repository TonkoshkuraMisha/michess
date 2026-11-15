"""
Дебютные книги мастеров второй волны (таск 21.5) из их партий в базе: архив исторических партий (`games` с
архивными игроками) и библиотека партий (`library_games`, таски 27.1–27.3). Одинаковые партии считаются один раз.
Ходы — первые 16 полуходов, только ходы самого мастера; формат — как у книг первой волны
(scripts/build_opening_books.py): [ход UCI, доля %, число партий].

    python scripts/build_master_books.py [--min-games 30]
"""

import argparse
import asyncio
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_opening_books import BOOKS_DIR, process_pgn_stream  # noqa: E402

ARCHIVE_PASSWORD = "!historical_archive_no_login!"


async def collect(surname: str, exclude: tuple[str, ...]) -> list[str]:
    from sqlalchemy import func, or_, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.orm import aliased
    from sqlalchemy.pool import NullPool

    from src.core.config import settings
    from src.models.game import Game
    from src.models.library import LibraryGame
    from src.models.user import User
    from src.services import library

    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    pattern = f"%{surname}%"
    texts: dict[str, str] = {}
    async with async_sessionmaker(engine)() as db:
        white, black = aliased(User), aliased(User)
        rows = (await db.execute(
            select(Game.pgn).join(white, white.id == Game.white_player_id).join(black, black.id == Game.black_player_id)
            .where(or_(white.username.ilike(pattern), black.username.ilike(pattern)),
                   white.hashed_password == ARCHIVE_PASSWORD, black.hashed_password == ARCHIVE_PASSWORD)
        )).scalars().all()
        for pgn in rows:
            parsed = library.parse_game(next(library.read_text(pgn), None)) if pgn else None
            if parsed is not None:  # одна партия из архива и из библиотеки — по одному ключу ходов
                texts[parsed.moves_hash] = pgn
        games = (await db.execute(
            select(LibraryGame).where(or_(func.lower(LibraryGame.white).like(pattern.lower()),
                                          func.lower(LibraryGame.black).like(pattern.lower())))
        )).scalars().all()
        for game in games:
            texts[game.moves_hash] = library.to_pgn(game)
    await engine.dispose()
    return [text for text in texts.values() if not any(word in text.lower() for word in exclude)]


def build(master_id: str, pgns: list[str], min_games: int) -> None:
    from src.services.bots.masters import MASTERS_BY_ID

    master = MASTERS_BY_ID[master_id]
    additions: dict[str, dict[str, int]] = {}
    total = process_pgn_stream(io.StringIO("\n\n".join(pgns)), master.surname, master.exclude, additions)
    if total < min_games:
        print(f"[!] {master_id}: only {total} games — book not written")
        return
    book = {}
    for fen, moves in additions.items():
        ordered = sorted(moves.items(), key=lambda item: item[1], reverse=True)
        count = sum(moves.values())
        book[fen] = [[uci, max(int(n / count * 100), 1), n] for uci, n in ordered]
    target = BOOKS_DIR / f"{master_id}.json"
    target.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[+] {master_id}: {total} games, {len(book)} positions -> {target.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-games", type=int, default=30)
    args = parser.parse_args()
    from src.services.bots.masters import MASTERS

    for master in MASTERS:
        build(master.id, asyncio.run(collect(master.surname, master.exclude)), args.min_games)


if __name__ == "__main__":
    main()
