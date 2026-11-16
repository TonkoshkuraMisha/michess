"""Мастера второй волны (таск 21.5): реестр, книги из своих партий, класс на каждого, портреты, вне лестницы."""

import pathlib

import chess

from src.api.bots import AVAILABLE_BOTS, BOT_METADATA, reserved_bot_usernames
from src.services import ladder
from src.services.bots import BOT_INSTANCES
from src.services.bots.masters import MASTER_BOTS, MASTERS

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_masters_are_registered_with_books():
    assert [m.id for m in MASTERS] == ["steinitz", "lasker", "rubinstein", "capablanca", "alekhine", "chigorin",
                                       "tarrasch", "pillsbury", "marshall", "nimzowitsch", "reti", "tartakower",
                                       "botvinnik", "tal", "petrosian"]
    for master in MASTERS:
        bot = BOT_INSTANCES[master.id]
        assert bot is MASTER_BOTS[master.id] and bot.bot_id == master.id
        assert len(bot.opening_book) > 100, master.id
        move, comment = bot._book_move(chess.Board())
        assert move in chess.Board().legal_moves
        assert comment["key"] == f"book.{master.id}" and comment["params"]["games"] > 0
        assert bot.strength.uci_elo == master.rating
        # Турнирная симуляция создаёт свежего бота без аргументов.
        fresh = type(bot)()
        assert fresh.bot_id == master.id and fresh is not bot


def test_metadata_portraits_ladder_and_names():
    for master in MASTERS:
        meta = BOT_METADATA[master.id]
        assert meta["ladder"] is False and meta["rating"] == master.rating
        portrait = ROOT / "frontend" / "public" / meta["avatar"].lstrip("/")
        assert portrait.is_file(), portrait
        assert master.id in reserved_bot_usernames()
    rung_keys = {r.key for r in ladder.rungs()}
    assert not rung_keys & {m.id for m in MASTERS}
    assert len([b for b in AVAILABLE_BOTS if b.get("ladder", True)]) == 7  # первая волна — как была


def test_books_cover_only_the_masters_own_moves():
    """В книге — ходы стороны мастера: у белых и у чёрных позиции разные, но обе есть (он играл обоими цветами)."""
    book = BOT_INSTANCES["capablanca"].opening_book
    turns = {key.split(" ")[1] for key in book}
    assert turns == {"w", "b"}
