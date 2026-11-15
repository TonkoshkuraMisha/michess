"""
Стартовые репертуары (таск 20.1): шесть готовых наборов линий — белыми и чёрными, для начинающих и для среднего
уровня. Линии — главные продолжения открытой таблицы дебютов (src/services/data/openings.tsv) и самые частые ответы
в архиве партий; ходы — общеизвестная теория, не чьи-то тексты. Названия и вводные тексты — на клиенте
(frontend/src/i18n/messages/*.ts, ключи repertoire.starters.<id>.*), здесь только коды и ходы.

Правила набора (проверяет tests/test_repertoire.py): все ходы легальны, в каждой позиции у игрока один свой ход,
каждая линия заканчивается в позиции с названием дебюта из таблицы.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Starter:
    id: str
    color: str  # white | black
    level: str  # beginner | intermediate
    lines: tuple[str, ...]  # SAN из начальной позиции, без номеров ходов


STARTERS: tuple[Starter, ...] = (
    Starter("italian", "white", "beginner", (
        "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5 exd5 Nxd5 Qb3",
        "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O O-O Re1 d6 c3",
        "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O Nbd2",
        "e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O O-O",
        "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3",
        "e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3",
        "e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3",
        "e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3",
        "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2",
        "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3",
        "e4 d6 d4 Nf6 Nc3 g6 Be3",
    )),
    Starter("london", "white", "beginner", (
        "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3",
        "d4 d5 Bf4 c5 e3 Nc6 c3 Nf6 Nd2",
        "d4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3",
        "d4 Nf6 Bf4 e6 e3 c5 c3 Nc6 Nd2 d5 Ngf3 Bd6 Bg3",
        "d4 f5 Bf4 Nf6 e3 e6 Nf3",
    )),
    Starter("open_games", "black", "beginner", (
        "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5",
        "e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6 c3 O-O",
        "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 d6",
        "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O",
        "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6",
        "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7",
        "e4 e5 Nc3 Nf6 f4 d5",
        "e4 e5 f4 d5 exd5 exf4 Nf3 Nf6",
        "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6",
        "d4 d5 c4 e6 Nf3 Nf6 Nc3 Be7",
        "d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6",
        "d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 b3 Nc6",
        "c4 e5 Nc3 Nf6 Nf3 Nc6",
    )),
    Starter("queens_gambit", "white", "intermediate", (
        "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 O-O Bd3 Nbd7 Qc2 c6 Nf3 Re8 O-O",
        "d4 d5 c4 e6 Nc3 Nf6 cxd5 Nxd5 e4 Nxc3 bxc3",
        "d4 d5 c4 e6 Nc3 Be7 cxd5 exd5 Bf4",
        "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O",
        "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Qc2 Bd6 Bd3",
        "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 dxc5 Qxd1 Rxd1 Bxc5",
        "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5",
        "d4 Nf6 c4 e6 Nc3 d5 cxd5 exd5",
        "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7",
        "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Be3",
        "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O",
        "d4 f5 g3 Nf6 Bg2 e6 Nf3 d5 O-O Bd6 c4 c6",
        "d4 e6 c4 Bb4+ Bd2",
    )),
    Starter("caro_kann", "black", "intermediate", (
        "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6",
        "e4 c6 d4 d5 Nd2 dxe4 Nxe4 Bf5",
        "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 O-O Nc6 c3 cxd4 cxd4 Nge7",
        "e4 c6 d4 d5 e5 Bf5 Nc3 e6 g4 Bg6 Nge2 c5 h4 h5",
        "e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7",
        "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7",
        "e4 c6 Nc3 d5 Nf3 Bg4 h3 Bxf3 Qxf3 e6",
        "e4 c6 d3 d5 Nd2 e5 Ngf3 Bd6",
        "e4 c6 c4 d5 exd5 cxd5 cxd5 Nf6",
        "e4 c6 d4 d5 f3 e6 Nc3 Bb4",
    )),
    Starter("nimzo_indian", "black", "intermediate", (
        "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7",
        "d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 d5 Nf3 dxc4 Qxc4 b6",
        "d4 Nf6 c4 e6 Nc3 Bb4 a3 Bxc3+ bxc3 c5 e3 Nc6",
        "d4 Nf6 c4 e6 Nc3 Bb4 f3 d5 a3 Bxc3+ bxc3 c5 cxd5 Nxd5",
        "d4 Nf6 c4 e6 Nc3 Bb4 Bg5 h6 Bh4 c5 d5 d6",
        "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6",
        "d4 Nf6 c4 e6 Nf3 b6 a3 Bb7 Nc3 d5 cxd5 Nxd5",
        "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6",
        "d4 Nf6 Nf3 e6 Bf4 c5 e3 Nc6 c3 d5",
        "d4 Nf6 Nf3 e6 c4 b6",
        "d4 Nf6 Bf4 e6 e3 c5 c3 Nc6 Nd2 d5",
        "d4 Nf6 Bg5 e6 e4 h6 Bxf6 Qxf6",
        "c4 Nf6 Nc3 e6 e4 c5",
        "Nf3 Nf6 c4 e6 Nc3 Bb4",
    )),
)

BY_ID: dict[str, Starter] = {starter.id: starter for starter in STARTERS}
