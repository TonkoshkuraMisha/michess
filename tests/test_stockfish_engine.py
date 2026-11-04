# --- FILE: tests/test_stockfish_engine.py ---

import chess
from src.services.bots.base import analyse_with_stockfish, resolve_stockfish_path
from src.services.bots import BOT_INSTANCES


def test_stockfish_binary_exists_and_works():
    sf_path = resolve_stockfish_path()
    assert sf_path is not None, "Бинарник Stockfish не найден ни в bin/, ни в системном PATH"

    board = chess.Board()
    scores = analyse_with_stockfish(board, sf_path, skill_level=5, uci_elo=1800, depth=4, multipv=3)
    assert len(scores) > 0, "Stockfish должен возвращать оценки кандидатов для стартовой позиции"

    for bot_id, bot in BOT_INSTANCES.items():
        assert bot._get_active_engine_path() is not None, f"У бота {bot_id} не подключен путь к Stockfish"
