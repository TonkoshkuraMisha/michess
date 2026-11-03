# --- FILE: tests/test_stockfish_engine.py ---

import chess
from src.services.bots.philidor import resolve_stockfish_path
from src.services.bots.morphy import morphy_bot


def test_stockfish_binary_exists_and_works():
    sf_path = resolve_stockfish_path()
    assert sf_path is not None, "Бинарник Stockfish не найден в папке bin/! Запусти python scripts/setup_script.py"

    # Проверяем, что Морфи находит тактический сильный ход через Stockfish (или книгу)
    # Позиция после 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4 (Гамбит Эванса)
    evans_fen = "r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4"
    result = morphy_bot.choose_move(evans_fen)

    assert result["uci"] is not None
    assert len(result["uci"]) >= 4
    print(f"[+] Морфи успешно сходил: {result['uci']} (Источник: {result['source']})")
