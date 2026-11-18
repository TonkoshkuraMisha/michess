# --- FILE: tests/test_result_normalization.py ---
"""
Итог партии из чужого PGN (ревизия базы 29.1, находка 3): game_engine.normalize_result приводит варианты записи к
стандарту, загрузчик архива и импорт пользуются им, а база не принимает нестандартный итог (CHECK games.result).
"""

import pytest
from sqlalchemy.exc import IntegrityError

from src.db.seed import extract_pgn_metadata
from src.models.game import Game, GameStatus
from src.services.game_engine import GAME_RESULTS, normalize_result


@pytest.mark.parametrize(("tag", "expected"), [
    ("1-0", "1-0"), ("0-1", "0-1"), ("1/2-1/2", "1/2-1/2"), ("*", "*"),
    ("½-½", "1/2-1/2"), ("1/2", "1/2-1/2"), ("0.5-0.5", "1/2-1/2"), ("1:0", "1-0"), ("0:1", "0-1"),
    (" 1-0 ", "1-0"), ("?", "*"), ("", "*"), (None, "*"), ("white wins", "*"),
])
def test_normalize_result(tag, expected):
    assert normalize_result(tag) == expected
    assert normalize_result(tag) in GAME_RESULTS


def test_archive_loader_normalizes_the_result_tag():
    assert extract_pgn_metadata('[Result "½-½"]\n\n1. e4 e5 ½-½')["result"] == "1/2-1/2"
    assert extract_pgn_metadata('[Result "?"]\n\n1. e4')["result"] == "*"
    assert extract_pgn_metadata("1. e4 e5 2. Qh5 Nc6 1-0")["result"] == "1-0"


async def test_database_refuses_a_non_standard_result(db_session, test_user_1, test_user_2):
    db_session.add(Game(white_player_id=test_user_1.id, black_player_id=test_user_2.id,
                        status=GameStatus.COMPLETED, result="½-½"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
