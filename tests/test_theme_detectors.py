"""Распознавание тем без тега базы (таск 27.8): каждое правило на построенной позиции, и пустой ответ на обычной."""

from src.services.theme_detectors import detect


def test_greek_gift():
    fen = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R b KQ - 0 8"
    codes = detect(fen, ["a7a6", "d3h7", "g8h7", "f3g5"], ["kingsideAttack", "sacrifice"])
    assert "greek_gift" in codes and "sacrifice" in codes


def test_lucena_material_and_placement():
    assert "lucena" in detect("1K1k4/1P6/8/8/8/8/r7/2R5 b - - 0 1", ["d8e7", "c1e1"], ["rookEndgame"])


def test_basic_mate():
    assert "basic_mates" in detect("6k1/8/6K1/8/8/8/8/R7 b - - 0 1", ["g8h8", "a1a8"], ["mate", "mateIn1"])


def test_opening_trap():
    fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"
    assert "opening_trap" in detect(fen, ["g8f6", "h5f7"], ["opening", "mate", "mateIn1"])


def test_tag_combinations():
    fen = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"
    moves = ["g8f6", "h5f7"]
    assert "combination" in detect(fen, moves, ["fork", "pin"])
    assert "unstoppable_threat" in detect(fen, moves, ["quietMove", "mate"])
    assert "combination" not in detect(fen, moves, ["fork"])


def test_ordinary_position_gets_nothing_and_bad_input_is_safe():
    assert detect("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", ["f1c4", "g8f6"], []) == []
    assert detect("not a fen", ["e2e4"], []) == []
    assert detect("6k1/8/6K1/8/8/8/8/R7 b - - 0 1", ["g8h8", "a1a7"], []) == []  # не мат — без темы
