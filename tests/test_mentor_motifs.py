# --- FILE: tests/test_mentor_motifs.py ---
"""
Детектор мотивов наставника на классических позициях.

Каждая позиция проверяется дважды: как есть и в зеркальном отражении с переменой цвета
(``board.mirror()``) — мотив должен найтись у другой стороны на отражённом поле. Это удваивает число
проверок и ловит правила, которые по ошибке работают только за белых.

Ловушки (позиции, где мотива нет) не менее важны: наставник, который видит вилку там, где её нет,
вреднее молчащего.
"""

import time

import chess
import pytest

from src.services.mentor_service import (
    Motif,
    analyze_move,
    capture_gain,
    detect_motifs,
)

W, B = chess.WHITE, chess.BLACK
sq = chess.parse_square


def _mirror_move(move: chess.Move) -> chess.Move:
    return chess.Move(chess.square_mirror(move.from_square), chess.square_mirror(move.to_square), move.promotion)


def _found(board: chess.Board, san: str | None) -> list[Motif]:
    """Мотивы позиции, а если задан ход, — созданные ходом (в пользу сходившего)."""
    if san is None:
        return detect_motifs(board)
    return analyze_move(board, board.parse_san(san)).created


def _variants(fen: str, san: str | None):
    """Позиция как есть и зеркальная; функция отражения для ожидаемых полей и цвета."""
    board = chess.Board(fen)
    assert board.is_valid(), board.status()
    yield board, san, (lambda s: s), (lambda c: c)
    mirrored = board.mirror()
    mirrored_san = None
    if san is not None:
        mirrored_san = mirrored.san(_mirror_move(board.parse_san(san)))
    yield mirrored, mirrored_san, chess.square_mirror, (lambda c: not c)


def _has(motifs: list[Motif], code: str, color: chess.Color, square: chess.Square,
         targets: set[chess.Square] | None, value: int | None) -> bool:
    for motif in motifs:
        if (motif.code, motif.color, motif.square) != (code, color, square):
            continue
        if targets is not None and set(motif.targets) != targets:
            continue
        if value is not None and motif.value != value:
            continue
        return True
    return False


def _describe(motifs: list[Motif]) -> list[str]:
    return [
        f"{m.code}/{'W' if m.color else 'B'}@{chess.square_name(m.square)}"
        f"->{[chess.square_name(t) for t in m.targets]}={m.value}"
        for m in motifs
    ]


# (мотив, FEN, ход или None, сторона, поле, цели или None, значение или None)
POSITIVE = [
    # Незащищённая фигура: конь на e4 под боем коня c3; ферзь под боем пешки (пешку отыграют — чистыми +800).
    ("hanging", "rnbqkb1r/pppp1ppp/8/4p3/4n3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 4", None, W, "e4", {"c3"}, 300),
    ("hanging", "rnb1kbnr/pppp1ppp/8/4p3/3q4/2P5/PP1PPPPP/RNBQKBNR w KQkq - 0 3", None, W, "d4", {"c3"}, 800),
    # Вилка: конь на c7 бьёт короля и ладью; пешка d5 — коня и слона (пешка защищена, взять её невыгодно).
    ("fork", "r3k2r/ppp2ppp/8/1N6/8/8/PPP2PPP/R3K2R w KQkq - 0 1", "Nxc7+", W, "c7", {"a8", "e8"}, None),
    ("fork", "r2qk2r/ppp2ppp/2n1b3/8/3P4/2N5/PPP2PPP/R1BQK2R w KQkq - 0 1", "d5", W, "d5", {"c6", "e6"}, None),
    # Связка с королём: слон b5 и конь c6 (испанская после ...d6); ладья e1 и конь e7.
    ("pin_absolute", "r1bqkbnr/ppp2ppp/2np4/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", None, W, "b5",
     {"c6", "e8"}, None),
    ("pin_absolute", "4k3/4n3/8/8/8/8/8/4RK2 w - - 0 1", None, W, "e1", {"e7", "e8"}, None),
    # Связка с ферзём: Bg5 и конь f6; ладья d1 и слон d6.
    ("pin_relative", "rnbqkb1r/ppp2ppp/3p1n2/4p1B1/4P3/3P4/PPP2PPP/RN1QKBNR b KQkq - 1 4", None, W, "g5",
     {"f6", "d8"}, None),
    ("pin_relative", "3qk3/8/3b4/8/8/8/8/3RK3 w - - 0 1", None, W, "d1", {"d6", "d8"}, None),
    # Сквозной удар: король впереди, ферзь сзади; ферзь впереди, ладья сзади.
    ("skewer", "q7/8/8/k7/8/8/8/R3K3 b - - 0 1", None, W, "a1", {"a5", "a8"}, None),
    ("skewer", "7k/8/1r6/2q5/8/8/5B2/4K3 b - - 0 1", None, W, "f2", {"c5", "b6"}, None),
    # Вскрытое нападение: слон уходит — ладья бьёт ферзя; конь уходит — слон бьёт ладью.
    ("discovered_attack", "3qk3/8/8/8/8/3B4/8/3RK3 w - - 0 1", "Bh7", W, "d1", {"d8"}, None),
    ("discovered_attack", "4k3/8/5r2/8/3N4/8/1B6/4K3 w - - 0 1", "Nb5", W, "b2", {"f6"}, None),
    # Вскрытый шах: конь уходит с линии ладьи; конь уходит с диагонали слона.
    ("discovered_check", "4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1", "Nc5+", W, "e1", {"e8", "c5"}, None),
    ("discovered_check", "7k/8/8/8/8/8/1N6/B3K3 w - - 0 1", "Nd3+", W, "a1", {"h8", "d3"}, None),
    # Двойной шах: и конь, и ладья; и слон, и ферзь.
    ("double_check", "4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1", "Nf6+", W, "e1", {"e8", "f6"}, None),
    ("double_check", "4k3/8/8/8/4B3/8/8/4Q1K1 w - - 0 1", "Bc6+", W, "e1", {"e8", "c6"}, None),
    # Перегрузка: ферзь d7 — единственная защита коня c6 и слона e6; конь d7 — двух слонов.
    ("overloaded", "4k3/3q4/2n1b3/1B4N1/8/8/8/4K3 w - - 0 1", None, W, "d7", {"c6", "e6"}, None),
    ("overloaded", "4k3/3n4/1b3b2/B7/6N1/8/8/4K3 w - - 0 1", None, W, "d7", {"b6", "f6"}, None),
    # Пойманная фигура: слон на a7 после ...b6; конь на h8 — оба поля отступления бьются.
    ("trapped", "r1bqkbnr/B1pp1ppp/1pn5/4p3/4P3/8/PPPP1PPP/RN1QKBNR w KQkq - 0 5", None, B, "a7", None, 300),
    ("trapped", "4k2N/5p2/6p1/8/8/8/K7/7r w - - 0 1", None, B, "h8", None, 300),
    # Слабость последней горизонтали: «форточки» нет, ладья соперника бьёт горизонталь.
    ("back_rank", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1", None, W, "g8", {"d8"}, None),
    ("back_rank", "7k/6pp/8/8/8/8/6PP/4R1K1 b - - 0 1", None, W, "h8", {"e8"}, None),
    # Угроза мата: если бы ходили белые — мат по последней горизонтали.
    ("mate_threat", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1", None, W, "d1", {"d8"}, 1),
    ("mate_threat", "7k/6pp/8/8/8/8/6PP/4R1K1 b - - 0 1", None, W, "e1", {"e8"}, 1),
    # Мат в 1 ход и мат в 2 хода через шах (жертва на d8).
    ("mate_in", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", None, W, "d1", {"d8"}, 1),
    ("mate_in", "2r3k1/5ppp/8/8/8/8/3R1PPP/3Q2K1 w - - 0 1", None, W, "d2", {"d8"}, 2),
    # Проходные пешки: значение — сколько полей до превращения.
    ("passed_pawn", "8/5k2/8/2P5/8/p7/5K2/8 w - - 0 1", None, W, "c5", None, 3),
    ("passed_pawn", "8/5k2/8/2P5/8/p7/5K2/8 w - - 0 1", None, B, "a3", None, 2),
    ("passed_pawn", "4k3/8/8/3P4/8/8/8/4K3 w - - 0 1", None, W, "d5", None, 3),
    # Ладья на открытой и полуоткрытой вертикали.
    ("open_file", "3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", None, W, "d1", None, None),
    ("open_file", "3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", None, B, "d8", None, None),
    ("half_open_file", "4k3/4p3/8/8/8/8/8/4RK2 w - - 0 1", None, W, "e1", None, None),
    ("half_open_file", "2r1k3/8/8/8/2P5/8/8/4K3 w - - 0 1", None, B, "c8", None, None),
    # Отставание в развитии: у чёрных три лёгкие фигуры дома против одной у белых.
    ("development_lag", "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 5 7", None, W, "e8",
     None, 3),
    ("development_lag", "r1bqkbnr/pp3ppp/2n5/8/8/2N2N2/PP3PPP/R1BQ1RK1 b kq - 0 12", None, W, "e8", None, 2),
    # Король застрял в центре: 12-й ход, вертикали d и e без своих пешек, у соперника есть ферзь.
    ("delayed_castling", "r1bqkbnr/pp3ppp/2n5/8/8/2N2N2/PP3PPP/R1BQ1RK1 b kq - 0 12", None, W, "e8", None, None),
    ("delayed_castling", "rnbqk2r/pp3ppp/5n2/8/1b6/2N2N2/PP3PPP/R1BQ1RK1 b kq - 0 10", None, W, "e8", None, None),
    # Батарея: ладья впереди ферзя по вертикали e — на короля; слон впереди ферзя по диагонали — на пешку g7.
    ("battery", "4k3/8/8/8/8/8/4R3/4Q1K1 b - - 0 1", None, W, "e2", {"e1", "e8"}, None),
    ("battery", "6k1/6p1/8/8/8/2B5/1Q6/6K1 w - - 0 1", None, W, "c3", {"b2", "g7"}, None),
    # Перекрытие: слон встаёт между ладьёй a8 и конём a4; конь d4 перекрывает слона h8, защищавшего ладью b2.
    ("interference", "r2B3k/8/8/8/n2R4/8/8/6K1 w - - 0 1", "Ba5", W, "a5", {"a8", "a4"}, None),
    ("interference", "k6b/8/1R6/5N2/8/8/1r6/7K w - - 0 1", "Nd4", W, "d4", {"h8", "b2"}, None),
]

NEGATIVE = [
    # Конь за коня: оба защищены пешками — не «висит» ни один.
    ("hanging", "4k3/8/3p4/4n3/8/5N2/6P1/4K3 w - - 0 1", None),
    # Конь нападает на ладью и на защищённого равноценного слона — цель одна, не вилка.
    ("fork", "4k3/2p5/1b3r2/3p4/1N6/8/8/4K3 w - - 0 1", "Nxd5"),
    # «Вилка» конём, которого король просто берёт.
    ("fork", "r2qkb1r/ppp2ppp/2n5/3p2N1/8/8/PPP2PPP/RNBQK2R w KQkq - 0 1", "Nxf7"),
    # Ферзь «связывает» коня с ладьёй, которая дешевле ферзя, — это не связка.
    ("pin_relative", "3rk3/3n4/8/8/8/8/8/3QK3 w - - 0 1", None),
    # За ферзём только пешка — не сквозной удар.
    ("skewer", "7k/8/1p6/2q5/8/8/5B2/4K3 b - - 0 1", None),
    # Конь уходит и открывает слону защищённую пешку — не вскрытое нападение.
    ("discovered_attack", "4k3/8/5p2/4p3/3N4/8/1B6/4K3 w - - 0 1", "Nb5"),
    # Конь с d6 сам даёт шах — это двойной, а не просто вскрытый шах.
    ("discovered_check", "4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1", "Nd6+"),
    # У коня c6 вторая защита — пешка b7: ферзь не перегружен.
    ("overloaded", "4k3/1p1q4/2n1b3/1B4N1/8/8/8/4K3 w - - 0 1", None),
    # Слон на a7 под боем, но уходит по диагонали b6–e3.
    ("trapped", "r1bqkbnr/Bppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RN1QKBNR w KQkq - 0 4", None),
    # «Форточка» h6 — горизонталь не слабая и мата нет.
    ("back_rank", "6k1/5pp1/7p/8/8/8/5PPP/3R2K1 b - - 0 1", None),
    ("mate_threat", "6k1/5pp1/7p/8/8/8/5PPP/3R2K1 b - - 0 1", None),
    # Поле d8 защищает ладья e8.
    ("back_rank", "4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1", None),
    ("mate_in", "4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", None),
    # Пешки на соседних вертикалях друг перед другом — проходных нет.
    ("passed_pawn", "8/5k2/3p4/2P5/8/8/5K2/8 w - - 0 1", None),
    ("passed_pawn", "4k3/8/8/8/1p6/8/P7/4K3 w - - 0 1", None),
    # Своя пешка на вертикали ладьи.
    ("half_open_file", "4k3/8/8/8/8/8/4P3/4RK2 w - - 0 1", None),
    ("open_file", "4k3/8/8/8/8/8/4P3/4RK2 w - - 0 1", None),
    # Дебют ещё идёт (3-й ход) — об отставании в развитии говорить рано.
    ("development_lag", "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", None),
    # Центр закрыт пешками d7/e5 — король в центре пока в безопасности.
    ("delayed_castling", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 b kq - 0 12", None),
    # У соперника нет ферзя.
    ("delayed_castling", "r1bqkbnr/pp3ppp/2n5/8/8/2N2N2/PP3PPP/R1B2RK1 b kq - 0 12", None),
    # «Сквозной удар» ладьёй, которую ферзь просто берёт (ладья ничем не защищена).
    ("skewer", "r2qr1k1/p4np1/2pb1nQp/8/5P2/2BB4/PPP2P1P/4R1K1 w - - 6 20", "Rxe8+"),
    # Ферзь «сквозным ударом» бьёт незащищённого ферзя — тот просто меняется.
    ("skewer", "3r1rk1/ppp3pp/2p1b3/2P5/8/2N1qPPp/PPP4K/R2Q1R2 w - - 5 17", "Qe1"),
    # «Связка» слоном, которого берёт пешка a6.
    ("pin_absolute", "r1bqkbnr/1pp2ppp/p1np4/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5", None),
    # Слон под боем и без отступления, но нападающую пешку снимает конь — фигура не поймана.
    ("trapped", "4k3/8/8/2p5/1B6/2N5/8/4K3 w - - 0 1", None),
    # Начальная позиция и спокойная итальянская партия — тактики нет.
    ("hanging", chess.STARTING_FEN, None),
    ("fork", "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 2 6", None),
    # Ладьи по вертикали, но линию закрывает свой конь; слон позади ладьи — линии разные.
    ("battery", "4k3/8/8/8/8/4N3/4R3/4R1K1 w - - 0 1", None),
    ("battery", "4k3/8/8/8/8/8/4R3/4B1K1 b - - 0 1", None),
    # Слон встаёт между ладьёй и конём, но коня защищает ещё и пешка b5 — взять его с выигрышем нельзя.
    ("interference", "r2B3k/8/8/1p6/n2R4/8/8/6K1 w - - 0 1", "Ba5"),
]


@pytest.mark.parametrize(("code", "fen", "san", "color", "square", "targets", "value"), POSITIVE)
def test_motif_is_found_in_both_colours(code, fen, san, color, square, targets, value):
    for board, move, flip_square, flip_color in _variants(fen, san):
        expected_targets = None if targets is None else {flip_square(sq(t)) for t in targets}
        motifs = _found(board, move)
        assert _has(motifs, code, flip_color(color), flip_square(sq(square)), expected_targets, value), (
            board.fen(), move, _describe(motifs))


@pytest.mark.parametrize(("code", "fen", "san"), NEGATIVE)
def test_motif_is_not_invented(code, fen, san):
    for board, move, _, _ in _variants(fen, san):
        motifs = _found(board, move)
        assert not [m for m in motifs if m.code == code], (board.fen(), move, _describe(motifs))


def test_every_motif_code_is_covered_by_positive_and_negative_cases():
    from typing import get_args

    from src.services.mentor_service import MotifCode

    covered = {case[0] for case in POSITIVE}
    assert covered == set(get_args(MotifCode))
    # Каждый мотив: не меньше двух позиций, каждая проверяется ещё и в зеркале (≥ 3 проверки на мотив).
    for code in covered:
        assert sum(1 for case in POSITIVE if case[0] == code) >= 2, code


# --- порядок целей и подробности ----------------------------------------------------------------


def test_pin_targets_are_pinned_piece_then_piece_behind():
    motif = next(m for m in detect_motifs(chess.Board("3qk3/8/3b4/8/8/8/8/3RK3 w - - 0 1"))
                 if m.code == "pin_relative")
    assert motif.targets == (sq("d6"), sq("d8"))


def test_mate_in_two_starts_with_a_check_that_forces_mate():
    board = chess.Board("2r3k1/5ppp/8/8/8/8/3R1PPP/3Q2K1 w - - 0 1")
    motif = next(m for m in detect_motifs(board) if m.code == "mate_in")
    first = chess.Move(motif.square, motif.targets[0])
    assert board.gives_check(first)
    board.push(first)
    replies = list(board.legal_moves)
    assert replies
    for reply in replies:
        board.push(reply)
        assert any(_mates(board, mate) for mate in list(board.legal_moves)), reply
        board.pop()


def _mates(board: chess.Board, move: chess.Move) -> bool:
    board.push(move)
    try:
        return board.is_checkmate()
    finally:
        board.pop()


def test_motif_serialises_with_square_names_and_pieces():
    board = chess.Board("r3k2r/ppp2ppp/8/1N6/8/8/PPP2PPP/R3K2R w KQkq - 0 1")
    board.push_san("Nxc7+")
    fork = next(m for m in detect_motifs(board) if m.code == "fork")

    assert fork.to_dict(board) == {
        "code": "fork", "color": "white", "square": "c7", "piece": "N",
        "targets": [{"square": "a8", "piece": "r"}, {"square": "e8", "piece": "k"}],
        "value": None,
    }


# --- размен на поле -----------------------------------------------------------------------------


@pytest.mark.parametrize(("fen", "square", "gain"), [
    ("4k3/8/8/4n3/8/5N2/8/4K3 w - - 0 1", "e5", 300),            # незащищённый конь
    ("4k3/8/3p4/4n3/8/5N2/8/4K3 w - - 0 1", "e5", 0),            # конь за коня
    ("4k3/8/3p4/4r3/8/5N2/8/4K3 w - - 0 1", "e5", 200),          # ладья за коня
    ("4k3/8/3p4/4p3/8/5Q2/8/4K3 w - - 0 1", "e5", None),         # ферзь не достаёт e5
    ("4k3/8/3p4/4p3/8/2B5/8/4K3 w - - 0 1", "e5", -200),         # слон за защищённую пешку
])
def test_capture_gain(fen, square, gain):
    assert capture_gain(chess.Board(fen), sq(square)) == gain


def test_capture_gain_respects_pins():
    # Конь c3 связан слоном b4 с королём e1 и не может взять на e4.
    board = chess.Board("4k3/8/8/8/1b2n3/2N5/8/4K3 w - - 0 1")
    assert capture_gain(board, sq("e4")) is None


# --- что изменил ход ----------------------------------------------------------------------------


def test_move_that_hangs_a_piece_is_reported_as_allowed():
    # Белый слон уходит на g5 под пешку h6. «Связка» пешки e7 с ферзём не засчитывается: слона просто берут.
    board = chess.Board("rnbqkbnr/ppppppp1/7p/8/8/3P4/PPP1PPPP/RNBQKBNR w KQkq - 0 2")
    facts = analyze_move(board, board.parse_san("Bg5"))

    assert any(m.code == "hanging" and m.color == B and m.square == sq("g5") for m in facts.allowed)
    assert facts.created == []


def test_moving_an_attacked_piece_away_resolves_the_threat():
    board = chess.Board("rnbqkb1r/pppp1ppp/8/4p3/4n3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 0 4")
    facts = analyze_move(board, board.parse_san("Nf6"))

    assert any(m.code == "hanging" and m.square == sq("e4") for m in facts.resolved)
    assert not any(m.code == "hanging" for m in facts.allowed)


def test_illegal_move_is_rejected():
    with pytest.raises(ValueError):
        analyze_move(chess.Board(), chess.Move.from_uci("e2e5"))


def test_finished_game_reports_no_motifs():
    """После мата — ни «вилки» ладьёй, давшей мат, ни слабостей: ученику объясняют сам мат."""
    board = chess.Board("r5kr/ppp2Rpp/1b6/n2Q4/2q5/B4N2/P4PPP/1R4K1 w - - 1 21")
    facts = analyze_move(board, board.parse_san("Rf8#"))
    assert facts.created == [] and facts.allowed == []


def test_detection_is_fast_enough_for_every_move_of_a_game():
    """Разбор партии вызывает детектор на каждом полуходе — в оживлённой позиции он укладывается в доли секунды."""
    board = chess.Board("r1bq1rk1/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8")
    started = time.perf_counter()
    for move in list(board.legal_moves):
        analyze_move(board, move)
    per_move_ms = (time.perf_counter() - started) * 1000 / board.legal_moves.count()
    assert per_move_ms < 100, per_move_ms
