# --- FILE: tests/test_position_index.py ---
"""Индекс позиций и таблица дебютов (таск 16.1)."""

import re

import chess
import pytest

from src.models.game import Game, GameStatus
from src.services import openings, position_index


def _pgn(moves: str, result: str, fen: str | None = None) -> str:
    headers = f'[Result "{result}"]\n' + (f'[SetUp "1"]\n[FEN "{fen}"]\n' if fen else "")
    return f"{headers}\n{moves} {result}\n"


@pytest.fixture
def make_game(db_session, test_user_1, test_user_2):
    async def make(moves: str, result: str = "1-0", **extra) -> Game:
        fen = extra.pop("fen", None)
        extra.setdefault("status", GameStatus.COMPLETED)
        game = Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id,
                    pgn=_pgn(moves, result, fen), result=result, **extra)
        db_session.add(game)
        await db_session.commit()
        return game
    return make


# --- дебюты ----------------------------------------------------------------------------------------

def test_openings_table_is_complete_and_well_formed():
    table = openings._table()
    assert len(table) > 3000
    assert all(re.fullmatch(r"[A-E]\d\d", o.eco) and o.name for o in table.values())


def test_opening_by_position_recognises_transpositions():
    direct = openings.classify(["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"])
    transposed = openings.classify(["c2c4", "e7e6", "b1c3", "g8f6", "d2d4", "f8b4"])
    assert direct == transposed and direct is not None and direct.eco == "E20"
    assert openings.classify(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]).name == "Ruy Lopez"


def test_unknown_or_broken_moves_fall_back():
    assert openings.classify([]) is None
    assert openings.eco_code([]) == "A00"
    assert openings.classify(["e2e4", "zzzz"]).eco == "B00"   # «King's Pawn Game» до сломанного хода


# --- индекс позиций ----------------------------------------------------------------------------------

async def test_moves_and_results_are_counted(db_session, make_game):
    for result in ("1-0", "1-0", "1/2-1/2", "0-1"):
        await position_index.index_game(db_session, await make_game("1. e4 e5 2. Nf3", result))
    await position_index.index_game(db_session, await make_game("1. d4 d5", "0-1"))
    await db_session.commit()
    stats = {s.move_uci: s for s in await position_index.moves_from(db_session, chess.Board())}
    assert [m for m in stats] == ["e2e4", "d2d4"]           # от частого к редкому
    e4 = stats["e2e4"]
    assert (e4.white_wins, e4.draws, e4.black_wins, e4.games) == (2, 1, 1, 4)
    board = chess.Board()
    board.push_san("e4")
    assert len(await position_index.games_through(db_session, board)) == 4


async def test_game_is_indexed_once(db_session, make_game):
    game = await make_game("1. e4 e5")
    assert await position_index.index_game(db_session, game)
    assert not await position_index.index_game(db_session, game)
    await db_session.commit()
    stats = await position_index.moves_from(db_session, chess.Board())
    assert stats[0].games == 1 and game.positions_indexed


async def test_skipped_games(db_session, make_game):
    simulation = await make_game("1. e4 e5", is_simulation=True)
    own_position = await make_game("1. e4 e5", fen="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")
    unfinished = await make_game("1. e4 e5", status=GameStatus.IN_PROGRESS)
    no_result = await make_game("1. e4 e5", "*")
    for game in (simulation, own_position, unfinished, no_result):
        await position_index.index_game(db_session, game)
    await db_session.commit()
    assert await position_index.moves_from(db_session, chess.Board()) == []


async def test_depth_and_repetitions(db_session, make_game):
    # Конями туда-обратно: стартовая позиция повторяется, но партия в ней считается один раз; дальше 30 полуходов
    # индекс не идёт.
    shuffle = " ".join(f"{2 * i + 1}. Nf3 Nf6 {2 * i + 2}. Ng1 Ng8" for i in range(10))
    game = await make_game(shuffle, "1/2-1/2")
    await position_index.index_game(db_session, game)
    await db_session.commit()
    stats = await position_index.moves_from(db_session, chess.Board())
    assert [(s.move_uci, s.games) for s in stats] == [("g1f3", 1)]
    assert len(await position_index.games_through(db_session, chess.Board())) == 1
    parsed = position_index.plies_of(game.pgn)
    assert parsed is not None and len(parsed[1]) == position_index.MAX_PLIES


def test_position_key_fits_signed_bigint():
    key = position_index.position_key(chess.Board())
    assert -(1 << 63) <= key < (1 << 63)
