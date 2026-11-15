"""
Чтение учебных баз закрытого формата (таск 27.3). Настоящих баз в репозитории нет (чужие издания), поэтому тест
собирает маленькую базу сам: кодировщик ниже — обратная операция к разбору, по тем же таблицам. Разбор настоящих
баз владельца проверен отдельно (все ходы легальны, совпадение с PGN тех же партий).
"""

import struct

import chess
import pytest

from src.services import cbh_reader as cbh

INVERSE_TWO_BYTE = {value: index for index, value in enumerate(cbh.TWO_BYTE_TABLE)}


class Encoder:
    """Партия → байты .cbg (без 4 байт заголовка): главная линия и варианты."""

    def __init__(self) -> None:
        self.counter = 0
        self.out = bytearray()

    def special(self, code: int) -> None:
        self.out.append((code + self.counter) % 256)

    def move(self, board: chess.Board, order: cbh.PieceOrder, move: chess.Move) -> None:
        color, piece, number = order.locate(move.from_square)
        long_form = move.promotion is not None or number >= 3
        if not long_form:
            dx = chess.square_file(move.to_square) - chess.square_file(move.from_square)
            dy = chess.square_rank(move.to_square) - chess.square_rank(move.from_square)
            if piece == chess.PAWN and color == chess.BLACK:
                dx, dy = -dx, -dy
            castle = board.is_castling(move)
            for code, (t_piece, t_number, tx, ty) in cbh.TOKENS.items():
                if (t_piece, t_number) != (piece, number):
                    continue
                if piece == chess.KING and (code in (cbh.CASTLE_SHORT, cbh.CASTLE_LONG)) != castle:
                    continue
                if (tx % 8, ty % 8) == (dx % 8, dy % 8):
                    self.out.append((code + self.counter) % 256)
                    self.counter = (self.counter + 1) % 256
                    break
            else:
                raise AssertionError(f"no code for {move}")
        else:
            origin = chess.square_file(move.from_square) * 8 + chess.square_rank(move.from_square)
            target = chess.square_file(move.to_square) * 8 + chess.square_rank(move.to_square)
            promotion = cbh.PROMOTIONS.index(move.promotion) if move.promotion else 0
            value = origin | (target << 6) | (promotion << 12)
            self.special(cbh.TWO_BYTE)
            for byte in (value >> 8, value & 0xFF):
                self.out.append((INVERSE_TWO_BYTE[byte] + self.counter) % 256)
            self.counter = (self.counter + 1) % 256
        order.apply(board, move)
        board.push(move)

    def line(self, board: chess.Board, order: cbh.PieceOrder, sans: str) -> None:
        for san in sans.split():
            self.move(board, order, board.parse_san(san))


def encode(main: str, variation_at: int | None = None, variation: str = "", null_after: bool = False) -> bytes:
    enc = Encoder()
    board, order = chess.Board(), cbh.PieceOrder.initial()
    for i, san in enumerate(main.split()):
        if i == variation_at:
            enc.special(cbh.VARIATION_START)
            v_board, v_order = board.copy(), cbh.PieceOrder({k: list(v) for k, v in order.slots.items()})
            enc.line(v_board, v_order, variation)
            enc.special(cbh.VARIATION_END)
            enc.special(cbh.SKIP)
        enc.move(board, order, board.parse_san(san))
    if null_after:
        enc.special(cbh.NULL_MOVE)
        enc.counter += 1
        enc.line(board, order, "Ke2")  # после нулевого хода партия обрывается
    enc.special(cbh.VARIATION_END)
    return bytes(enc.out)


def _parse(line: str) -> list[chess.Move]:
    board = chess.Board()
    return [board.push_san(san) for san in line.split()]


def sans(moves: list[chess.Move]) -> str:
    return chess.Board().variation_san(moves)


def test_castling_en_passant_capture_renumbering():
    # Взятие на проходе (exd6); белый конь №0 (b1) погибает на d5 — ходит бывший №1 (g1), теперь он №0; у чёрных
    # погибает конь №0 (b8) — дальше ходит бывший №1; обе рокировки.
    line = "e4 Nf6 e5 d5 exd6 Nc6 Nc3 Nd4 Nd5 Nxd5 Nf3 Nxf3+ Qxf3 Nb4 Bc4 Be6 O-O Qxd6 d3 O-O-O a3 Nc6 Bxe6+ fxe6 Qf7 g6"
    moves = cbh.decode_moves(encode(line))
    assert sans(moves) == chess.Board().variation_san([m for m in _parse(line)])


def test_fourth_piece_and_underpromotion_use_two_bytes():
    line = "a4 h5 a5 h4 a6 h3 axb7 hxg2 bxa8=Q gxh1=R Qxb8 Rxg1+"
    moves = cbh.decode_moves(encode(line))
    assert sans(moves) == "1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 5. bxa8=Q gxh1=R 6. Qxb8 Rxg1"


def test_variations_are_skipped_but_counted():
    data = encode("e4 e5 Nf3 Nc6 Bb5", variation_at=2, variation="Bc4 Nf6 d3")
    assert sans(cbh.decode_moves(data)) == "1. e4 e5 2. Nf3 Nc6 3. Bb5"


def test_null_move_ends_the_line_and_garbage_raises():
    assert len(cbh.decode_moves(encode("e4 e5", null_after=True))) == 2
    with pytest.raises(cbh.DecodeError):
        cbh.decode_moves(bytes([0x58]))  # конь b1 «прыгает» на d2, где своя пешка


def test_guess_encoding():
    assert cbh.guess_encoding(["Ботвинник".encode("cp1251"), b"Euwe"]) == "cp1251"
    assert cbh.guess_encoding(["Müller".encode("cp1252"), b"Tal"]) == "cp1252"
    assert cbh.guess_encoding([b"Tal"]) == "cp1252"


def _record(offset: int, white: int, black: int, tournament: int, year: int, result: int, flags: int = 1) -> bytes:
    rec = bytearray(cbh.RECORD)
    rec[0] = flags
    rec[1:5] = struct.pack(">I", offset)
    rec[9:12], rec[12:15], rec[15:18] = white.to_bytes(3, "big"), black.to_bytes(3, "big"), tournament.to_bytes(3, "big")
    rec[24:27] = ((year << 9) | (5 << 5) | 17).to_bytes(3, "big")
    rec[27], rec[29] = result, 3
    rec[31:35] = struct.pack(">HH", 2600, 0)
    return bytes(rec)


def _names(records: list[tuple[bytes, ...]], size: int, spans: tuple[tuple[int, int], ...]) -> bytes:
    data = bytearray(32)
    data[0x18] = 4
    for values in records:
        rec = bytearray(size)
        for (start, end), value in zip(spans, values, strict=True):
            rec[start:start + len(value)] = value[:end - start]
        data += rec
    return bytes(data)


def test_database_headers_and_skips(tmp_path):
    games = bytearray()
    index = bytearray(cbh.RECORD)
    for flags_game, moves, record_flags in ((0, "e4 e5 Nf3", 1), (cbh.NOT_INITIAL, "d4", 1), (0, "c4", 0x81),
                                            (0, "Nf3 d5", 1), (0, "", 0)):
        body = encode(moves) if moves else b""
        offset = len(games)
        games += struct.pack(">I", flags_game | (len(body) + 4)) + body
        index += _record(offset, 0, 1, 0, 1934, 2 if moves == "e4 e5 Nf3" else 1, record_flags)
    base = tmp_path / "уч. шахм. окончаний"  # точки в имени — как у настоящих баз
    base.with_name(base.name + ".cbh").write_bytes(bytes(index))
    base.with_name(base.name + ".cbg").write_bytes(bytes(games))
    base.with_name(base.name + ".cbp").write_bytes(_names([("Ботвинник".encode("cp1251"), "Михаил".encode("cp1251")),
                                                 ("Эйве".encode("cp1251"), b"")], cbh.PLAYER_RECORD, ((9, 39), (39, 59))))
    base.with_name(base.name + ".cbt").write_bytes(_names([("Гастингс".encode("cp1251"), b"Hastings")], cbh.TOURNAMENT_RECORD,
                                                ((9, 49), (49, 79))))
    db = cbh.Database.open(base.with_name(base.name + ".cbh"))
    found = list(db)
    assert db.encoding == "cp1251"
    assert [g.headers["Result"] for g in found] == ["1-0", "1/2-1/2"]
    first = found[0]
    assert (first.headers["White"], first.headers["Black"]) == ("Ботвинник, Михаил", "Эйве")
    assert (first.headers["Event"], first.headers["Site"], first.headers["Date"]) == ("Гастингс", "Hastings", "1934.05.17")
    assert (first.headers["Round"], first.headers["WhiteElo"], "BlackElo" in first.headers) == ("3", "2600", False)
    assert sans(list(first.mainline_moves())) == "1. e4 e5 2. Nf3"
    assert (db.stats.games, db.stats.not_initial, db.stats.deleted) == (2, 1, 1)
