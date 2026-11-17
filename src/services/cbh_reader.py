"""
Чтение учебных баз закрытого двоичного формата (`.cbh` + `.cbg` + `.cbp` + `.cbt`) в партии python-chess — для
библиотеки партий (таск 27.3). Инструмент разработки: в продукте не используется и не называется (правило 5).

Берутся только заголовки (игроки, турнир, место, дата, тур, результат, рейтинги) и главная линия. Варианты
пропускаются, комментарии (`.cba`) не читаются. Партии не из начальной позиции, шахматы-960 и записи без партии
пропускаются со счётчиком причин.

Устройство формата и таблицы кодирования ходов — по открытому конвертеру cbh2pgn (Dominik Klein, MIT,
github.com/asdfjkl/cbh2pgn; см. ATTRIBUTION.md). Код этого модуля свой.

Кратко о формате:
* `.cbh` — записи по 46 байт (нулевая — заголовок файла): флаги, смещение партии в `.cbg`, номера игроков и турнира
  (24 бита), дата (год:15, месяц:4, день:5), результат, тур, рейтинги.
* `.cbg` — партия: 4 байта (флаги и длина вместе с ними), затем ходы по байту. Байт хода = код + счётчик (mod 256);
  счётчик растёт на каждом ходе, включая ходы вариантов. Код хода — «какая по счёту фигура этого вида и куда
  сдвинулась» (сдвиг по модулю 8); порядок фигур вида меняется при взятиях (следующие сдвигаются вниз) и
  превращениях (новая фигура — на первое свободное место). Пешки нумеруются по исходной вертикали и не сдвигаются.
* Особые коды: 0x29 — следующий ход двумя байтами (поля откуда/куда и фигура превращения; для превращений и для
  четвёртой и следующих фигур вида), 0xDC/0x0C — начало/конец варианта, 0x9F — пропуск, 0xAA — нулевой ход.
"""

import struct
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import chess
import chess.pgn

RECORD = 46
PLAYER_RECORD = 67
TOURNAMENT_RECORD = 99

TWO_BYTE, VARIATION_START, VARIATION_END, SKIP, NULL_MOVE = 0x29, 0xDC, 0x0C, 0x9F, 0xAA
SPECIAL = (TWO_BYTE, VARIATION_START, VARIATION_END, SKIP)

KING_MOVES = {0x49: (0, 1), 0x39: (1, 1), 0xD8: (1, 0), 0x5D: (1, 7), 0xC2: (0, 7), 0xB1: (7, 7), 0xB2: (7, 0),
              0x47: (7, 1), 0x76: (2, 0), 0xB5: (-2, 0)}
CASTLE_SHORT, CASTLE_LONG = 0x76, 0xB5

QUEEN_MOVES = (
    {0xA5: (0, 1), 0xB8: (0, 2), 0xCB: (0, 3), 0x53: (0, 4), 0x7F: (0, 5), 0x6B: (0, 6), 0x8D: (0, 7), 0x79: (1, 0),
     0xBE: (2, 0), 0xEB: (3, 0), 0x21: (4, 0), 0x99: (5, 0), 0xD2: (6, 0), 0x57: (7, 0), 0x4D: (1, 1), 0xB4: (2, 2),
     0xBF: (3, 3), 0x62: (4, 4), 0xBD: (5, 5), 0x24: (6, 6), 0x96: (7, 7), 0xA7: (1, 7), 0x48: (2, 6), 0x28: (3, 5),
     0x6E: (4, 4), 0x2F: (5, 3), 0x5A: (6, 2), 0x18: (7, 1)},
    {0xE5: (0, 1), 0x94: (0, 2), 0x50: (0, 3), 0x11: (0, 4), 0xEA: (0, 5), 0x31: (0, 6), 0x01: (0, 7), 0x5C: (1, 0),
     0x95: (2, 0), 0xCA: (3, 0), 0xD3: (4, 0), 0x1D: (5, 0), 0x7E: (6, 0), 0xEF: (7, 0), 0x44: (1, 1), 0x80: (2, 2),
     0xA0: (3, 3), 0x1F: (4, 4), 0x83: (5, 5), 0x00: (6, 6), 0x4B: (7, 7), 0x67: (1, 7), 0x20: (2, 6), 0x5B: (3, 5),
     0x2A: (4, 4), 0x92: (5, 3), 0xB6: (6, 2), 0x60: (7, 1)},
    {0x1A: (0, 1), 0x42: (0, 2), 0x0F: (0, 3), 0x0D: (0, 4), 0xB0: (0, 5), 0xD1: (0, 6), 0x23: (0, 7), 0xF0: (1, 0),
     0x7A: (2, 0), 0x54: (3, 0), 0x4F: (4, 0), 0xF4: (5, 0), 0xA8: (6, 0), 0x72: (7, 0), 0xE7: (1, 1), 0x40: (2, 2),
     0x38: (3, 3), 0x59: (4, 4), 0x87: (5, 5), 0xE8: (6, 6), 0x6C: (7, 7), 0x86: (1, 7), 0x04: (2, 6), 0xF1: (3, 5),
     0x8C: (4, 4), 0xCE: (5, 3), 0x6A: (6, 2), 0xDB: (7, 1)},
)
ROOK_MOVES = (
    {0x4E: (0, 1), 0xF8: (0, 2), 0x43: (0, 3), 0xD7: (0, 4), 0x63: (0, 5), 0x9C: (0, 6), 0xE6: (0, 7), 0x2E: (1, 0),
     0xC6: (2, 0), 0x26: (3, 0), 0x88: (4, 0), 0x30: (5, 0), 0x61: (6, 0), 0x6F: (7, 0)},
    {0x14: (0, 1), 0xA9: (0, 2), 0x68: (0, 3), 0xEE: (0, 4), 0xFB: (0, 5), 0x77: (0, 6), 0xE2: (0, 7), 0xA6: (1, 0),
     0x05: (2, 0), 0x8B: (3, 0), 0xA1: (4, 0), 0x98: (5, 0), 0x32: (6, 0), 0x52: (7, 0)},
    {0x81: (0, 1), 0x82: (0, 2), 0x9A: (0, 3), 0x1B: (0, 4), 0x9D: (0, 5), 0x0A: (0, 6), 0x2B: (0, 7), 0x8F: (1, 0),
     0xCD: (2, 0), 0xED: (3, 0), 0x10: (4, 0), 0x74: (5, 0), 0x69: (6, 0), 0xD6: (7, 0)},
)
BISHOP_MOVES = (
    {0x02: (1, 1), 0x97: (2, 2), 0xE1: (3, 3), 0x41: (4, 4), 0xC3: (5, 5), 0x7C: (6, 6), 0xE4: (7, 7), 0x06: (1, 7),
     0xB7: (2, 6), 0x55: (3, 5), 0xD9: (4, 4), 0x2C: (5, 3), 0xAE: (6, 2), 0x37: (7, 1)},
    {0xF6: (1, 1), 0x3F: (2, 2), 0x08: (3, 3), 0x93: (4, 4), 0x73: (5, 5), 0x5E: (6, 6), 0x78: (7, 7), 0x35: (1, 7),
     0xF2: (2, 6), 0x6D: (3, 5), 0x71: (4, 4), 0xA2: (5, 3), 0xF3: (6, 2), 0x16: (7, 1)},
    {0x51: (1, 1), 0xB9: (2, 2), 0x45: (3, 3), 0x3B: (4, 4), 0x56: (5, 5), 0x91: (6, 6), 0xFD: (7, 7), 0xAB: (1, 7),
     0x66: (2, 6), 0x3E: (3, 5), 0x46: (4, 4), 0xB3: (5, 3), 0xFC: (6, 2), 0xC8: (7, 1)},
)
KNIGHT_MOVES = (
    {0x58: (2, 1), 0x3D: (1, 2), 0xFA: (-1, 2), 0xE9: (-2, 1), 0xBA: (-2, -1), 0xD4: (-1, -2), 0xDD: (1, -2),
     0x4A: (2, -1)},
    {0xC4: (2, 1), 0x0E: (1, 2), 0xFE: (-1, 2), 0x5F: (-2, 1), 0x75: (-2, -1), 0x07: (-1, -2), 0x89: (1, -2),
     0x34: (2, -1)},
    {0x9B: (2, 1), 0xC0: (1, 2), 0xE3: (-1, 2), 0xA3: (-2, 1), 0xAC: (-2, -1), 0xC9: (-1, -2), 0xEC: (1, -2),
     0x27: (2, -1)},
)
PAWN_MOVES = (  # пешки a…h; сдвиг — с точки зрения ходящей стороны
    {0x2D: (0, 1), 0xC1: (0, 2), 0x8E: (1, 1), 0xF5: (-1, 1)},
    {0x64: (0, 1), 0x17: (0, 2), 0x70: (1, 1), 0xA4: (-1, 1)},
    {0x7B: (0, 1), 0xDA: (0, 2), 0xE0: (1, 1), 0x85: (-1, 1)},
    {0xC5: (0, 1), 0x0B: (0, 2), 0x90: (1, 1), 0xF9: (-1, 1)},
    {0x84: (0, 1), 0xFF: (0, 2), 0x15: (1, 1), 0x36: (-1, 1)},
    {0x09: (0, 1), 0x9E: (0, 2), 0x7D: (1, 1), 0xDE: (-1, 1)},
    {0xBB: (0, 1), 0xDF: (0, 2), 0xBC: (1, 1), 0x3A: (-1, 1)},
    {0x12: (0, 1), 0x33: (0, 2), 0x13: (1, 1), 0x19: (-1, 1)},
)

# Байты двухбайтового хода: значение = таблица[(байт − счётчик) mod 256].
TWO_BYTE_TABLE = bytes((
    0xA2, 0x95, 0x43, 0xF5, 0xC1, 0x3D, 0x4A, 0x6C, 0x53, 0x83, 0xCC, 0x7C, 0xFF, 0xAE, 0x68, 0xAD,
    0xD1, 0x92, 0x8B, 0x8D, 0x35, 0x81, 0x5E, 0x74, 0x26, 0x8E, 0xAB, 0xCA, 0xFD, 0x9A, 0xF3, 0xA0,
    0xA5, 0x15, 0xFC, 0xB1, 0x1E, 0xED, 0x30, 0xEA, 0x22, 0xEB, 0xA7, 0xCD, 0x4E, 0x6F, 0x2E, 0x24,
    0x32, 0x94, 0x41, 0x8C, 0x6E, 0x58, 0x82, 0x50, 0xBB, 0x02, 0x8A, 0xD8, 0xFA, 0x60, 0xDE, 0x52,
    0xBA, 0x46, 0xAC, 0x29, 0x9D, 0xD7, 0xDF, 0x08, 0x21, 0x01, 0x66, 0xA3, 0xF1, 0x19, 0x27, 0xB5,
    0x91, 0xD5, 0x42, 0x0E, 0xB4, 0x4C, 0xD9, 0x18, 0x5F, 0xBC, 0x25, 0xA6, 0x96, 0x04, 0x56, 0x6A,
    0xAA, 0x33, 0x1C, 0x2B, 0x73, 0xF0, 0xDD, 0xA4, 0x37, 0xD3, 0xC5, 0x10, 0xBF, 0x5A, 0x23, 0x34,
    0x75, 0x5B, 0xB8, 0x55, 0xD2, 0x6B, 0x09, 0x3A, 0x57, 0x12, 0xB3, 0x77, 0x48, 0x85, 0x9B, 0x0F,
    0x9E, 0xC7, 0xC8, 0xA1, 0x7F, 0x7A, 0xC0, 0xBD, 0x31, 0x6D, 0xF6, 0x3E, 0xC3, 0x11, 0x71, 0xCE,
    0x7D, 0xDA, 0xA8, 0x54, 0x90, 0x97, 0x1F, 0x44, 0x40, 0x16, 0xC9, 0xE3, 0x2C, 0xCB, 0x84, 0xEC,
    0x9F, 0x3F, 0x5C, 0xE6, 0x76, 0x0B, 0x3C, 0x20, 0xB7, 0x36, 0x00, 0xDC, 0xE7, 0xF9, 0x4F, 0xF7,
    0xAF, 0x06, 0x07, 0xE0, 0x1A, 0x0A, 0xA9, 0x4B, 0x0C, 0xD6, 0x63, 0x87, 0x89, 0x1D, 0x13, 0x1B,
    0xE4, 0x70, 0x05, 0x47, 0x67, 0x7B, 0x2F, 0xEE, 0xE2, 0xE8, 0x98, 0x0D, 0xEF, 0xCF, 0xC4, 0xF4,
    0xFB, 0xB0, 0x17, 0x99, 0x64, 0xF2, 0xD4, 0x2A, 0x03, 0x4D, 0x78, 0xC6, 0xFE, 0x65, 0x86, 0x88,
    0x79, 0x45, 0x3B, 0xE5, 0x49, 0x8F, 0x2D, 0xB9, 0xBE, 0x62, 0x93, 0x14, 0xE9, 0xD0, 0x38, 0x9C,
    0xB2, 0xC2, 0x59, 0x5D, 0xB6, 0x72, 0x51, 0xF8, 0x28, 0x7E, 0x61, 0x39, 0xE1, 0xDB, 0x69, 0x80,
))
PROMOTIONS = (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT)

# Флаги первых 4 байт партии; младшие 24 бита — длина вместе с этими байтами.
NOT_ENCODED, NOT_INITIAL, SPECIAL_ENCODING, CHESS960 = 0x80000000, 0x40000000, 0x04000000, 0x0A000000
LENGTH = 0x00FFFFFF


def _token_table() -> dict[int, tuple[chess.PieceType, int, int, int]]:
    """Код хода → (вид фигуры, номер фигуры вида, сдвиг по вертикали, сдвиг по горизонтали)."""
    table: dict[int, tuple[chess.PieceType, int, int, int]] = {}
    for code, (dx, dy) in KING_MOVES.items():
        table[code] = (chess.KING, 0, dx, dy)
    for piece, groups in ((chess.QUEEN, QUEEN_MOVES), (chess.ROOK, ROOK_MOVES), (chess.BISHOP, BISHOP_MOVES),
                          (chess.KNIGHT, KNIGHT_MOVES), (chess.PAWN, PAWN_MOVES)):
        for number, group in enumerate(groups):
            for code, (dx, dy) in group.items():
                table[code] = (piece, number, dx, dy)
    return table


TOKENS = _token_table()


class DecodeError(ValueError):
    pass


@dataclass
class PieceOrder:
    """Номера фигур каждого вида у каждой стороны — так, как их считает формат."""

    slots: dict[tuple[chess.Color, chess.PieceType], list[chess.Square | None]] = field(default_factory=dict)

    @classmethod
    def initial(cls) -> PieceOrder:
        """
        Порядок фигур в начальной позиции. Формат записывает ход номером фигуры своего вида (первая ладья, вторая
        ладья…), поэтому нужно знать, на каком поле стоит каждая.
        """
        order = cls()
        for color, rank in ((chess.WHITE, 0), (chess.BLACK, 7)):
            pawn_rank = 1 if color == chess.WHITE else 6
            order.slots[(color, chess.KING)] = [chess.square(4, rank)]
            order.slots[(color, chess.QUEEN)] = [chess.square(3, rank)]
            order.slots[(color, chess.ROOK)] = [chess.square(0, rank), chess.square(7, rank)]
            order.slots[(color, chess.BISHOP)] = [chess.square(2, rank), chess.square(5, rank)]
            order.slots[(color, chess.KNIGHT)] = [chess.square(1, rank), chess.square(6, rank)]
            order.slots[(color, chess.PAWN)] = [chess.square(file, pawn_rank) for file in range(8)]
        return order

    def square_of(self, color: chess.Color, piece: chess.PieceType, number: int) -> chess.Square:
        slots = self.slots[(color, piece)]
        square = slots[number] if number < len(slots) else None
        if square is None:
            raise DecodeError(f"no piece {chess.piece_symbol(piece)}#{number}")
        return square

    def locate(self, square: chess.Square) -> tuple[chess.Color, chess.PieceType, int] | None:
        for (color, piece), slots in self.slots.items():
            if square in slots:
                return color, piece, slots.index(square)
        return None

    def apply(self, board: chess.Board, move: chess.Move) -> None:
        """Обновить номера перед тем, как ход сделан на доске (board — позиция до хода)."""
        mover = self.locate(move.from_square)
        if mover is None:
            raise DecodeError(f"no piece on {chess.square_name(move.from_square)}")
        color, piece, number = mover
        captured_square = move.to_square
        if board.is_en_passant(move):
            captured_square = chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
        victim = self.locate(captured_square)
        if victim is not None:
            v_color, v_piece, v_number = victim
            slots = self.slots[(v_color, v_piece)]
            if v_piece == chess.PAWN:
                slots[v_number] = None  # пешки не сдвигаются
            else:
                del slots[v_number]  # следующие фигуры вида сдвигаются вниз
        if board.is_castling(move):
            rook_from = chess.square(7 if board.is_kingside_castling(move) else 0, chess.square_rank(move.from_square))
            rook_to = chess.square(5 if board.is_kingside_castling(move) else 3, chess.square_rank(move.from_square))
            rooks = self.slots[(color, chess.ROOK)]
            if rook_from in rooks:
                rooks[rooks.index(rook_from)] = rook_to
        if move.promotion:
            self.slots[(color, chess.PAWN)][number] = None
            target = self.slots.setdefault((color, move.promotion), [])
            if None in target:
                target[target.index(None)] = move.to_square
            else:
                target.append(move.to_square)
        else:
            self.slots[(color, piece)][number] = move.to_square


def _one_byte_move(board: chess.Board, order: PieceOrder, code: int) -> chess.Move:
    if code not in TOKENS:
        raise DecodeError(f"unknown move code 0x{code:02X}")
    piece, number, dx, dy = TOKENS[code]
    color = board.turn
    if piece == chess.PAWN and color == chess.BLACK:
        dx, dy = -dx, -dy
    origin = order.square_of(color, piece, number)
    file, rank = chess.square_file(origin), chess.square_rank(origin)
    if piece == chess.KING and code in (CASTLE_SHORT, CASTLE_LONG):
        target = chess.square(file + dx, rank)
    else:
        target = chess.square((file + dx) % 8, (rank + dy) % 8)
    return chess.Move(origin, target)


def _two_byte_move(board: chess.Board, value: int) -> chess.Move:
    """Поле в формате: вертикаль·8 + горизонталь; в python-chess — горизонталь·8 + вертикаль."""
    origin, target, promotion = value & 0x3F, (value >> 6) & 0x3F, (value >> 12) & 0x3
    origin_sq, target_sq = chess.square(origin // 8, origin % 8), chess.square(target // 8, target % 8)
    piece = board.piece_at(origin_sq)
    if piece is not None and piece.piece_type == chess.PAWN and chess.square_rank(target_sq) in (0, 7):
        return chess.Move(origin_sq, target_sq, promotion=PROMOTIONS[promotion])
    return chess.Move(origin_sq, target_sq)


def decode_moves(data: bytes) -> list[chess.Move]:
    """Главная линия партии из начальной позиции; нелегальный или непонятный ход — DecodeError."""
    board = chess.Board()
    order = PieceOrder.initial()
    moves: list[chess.Move] = []
    counter = 0
    depth = 0
    index = 0
    while index < len(data):
        code = (data[index] - counter) % 256
        if code not in SPECIAL:
            counter = (counter + 1) % 256
        if code == SKIP:
            index += 1
            continue
        if code == VARIATION_START:
            depth += 1
            index += 1
            continue
        if code == VARIATION_END:
            if depth == 0:
                break  # конец партии
            depth -= 1
            index += 1
            continue
        if code == TWO_BYTE:
            if index + 2 >= len(data):
                raise DecodeError("truncated two-byte move")
            high = TWO_BYTE_TABLE[(data[index + 1] - counter) % 256]
            low = TWO_BYTE_TABLE[(data[index + 2] - counter) % 256]
            counter = (counter + 1) % 256
            index += 3
            if depth:
                continue
            move = _two_byte_move(board, (high << 8) | low)
        else:
            index += 1
            if depth:
                continue
            if code == NULL_MOVE:
                break  # нулевой ход — дальше партия в библиотеку не берётся
            move = _one_byte_move(board, order, code)
        if move not in board.legal_moves:
            raise DecodeError(f"illegal move {move.uci()} after {len(moves)} plies")
        order.apply(board, move)
        board.push(move)
        moves.append(move)
    return moves


@dataclass(frozen=True)
class Header:
    """Заголовок партии учебной базы: игроки, турнир, место, дата, тур, результат, рейтинги."""
    white: str
    black: str
    event: str
    site: str
    date: str
    round: str
    result: str
    white_elo: int
    black_elo: int


def _text(raw: bytes, encoding: str) -> str:
    raw = raw.split(b"\x00", 1)[0]
    try:
        return raw.decode("utf-8").strip()
    except UnicodeDecodeError:
        # Кодировка базы угадана по всем именам, но в учебных базах русские названия глав соседствуют с латинскими
        # именами: строка, где старшие байты — почти все буквы, — кириллица (cp1251).
        return raw.decode(guess_encoding([raw]) if encoding != "cp1251" else encoding, errors="replace").strip()


def _record_base(data: bytes) -> int:
    version = data[0x18] if len(data) > 0x18 else 0
    if version == 4:
        return 32
    if version == 0:
        return 28
    raise DecodeError(f"unknown index version {version}")


def guess_encoding(names: list[bytes]) -> str:
    """
    Старые базы — в однобайтовой кодировке. В имени кириллицей (cp1251) старшие байты — почти все буквы, в латинице
    с диакритикой (cp1252) — одна-две на имя: решает доля старших байтов среди букв имён, где они есть.
    """
    high = letters = 0
    for name in names:
        raw = name.split(b"\x00", 1)[0]
        name_high = sum(1 for b in raw if b >= 0x80)
        if name_high:
            high += name_high
            letters += name_high + sum(1 for b in raw if 0x41 <= b <= 0x5A or 0x61 <= b <= 0x7A)
    return "cp1251" if letters and high / letters > 0.5 else "cp1252"


@dataclass
class Stats:
    games: int = 0
    deleted: int = 0
    not_initial: int = 0
    unsupported: int = 0
    errors: int = 0
    reasons: list[str] = field(default_factory=list)


@dataclass
class Database:
    """
    Открытая учебная база: содержимое файлов индекса (.cbh), партий (.cbg), игроков (.cbp) и турниров (.cbt),
    кодировка имён и счётчики пропущенных записей.
    """
    base: Path  # путь без расширения
    index: bytes = b""
    games: bytes = b""
    players: bytes = b""
    tournaments: bytes = b""
    encoding: str = "cp1252"
    stats: Stats = field(default_factory=Stats)

    @classmethod
    def open(cls, cbh: Path) -> Database:
        def sibling(extension: str) -> Path:  # не with_suffix: в именах баз бывают точки («уч. шахм. окончаний»)
            return cbh.with_name(cbh.stem + extension)

        db = cls(base=sibling(""), index=cbh.read_bytes(), games=sibling(".cbg").read_bytes(),
                 players=sibling(".cbp").read_bytes(), tournaments=sibling(".cbt").read_bytes())
        db.encoding = guess_encoding(db._name_fields())
        return db

    def _name_fields(self) -> list[bytes]:
        fields: list[bytes] = []
        for data, size, spans in ((self.players, PLAYER_RECORD, ((9, 39), (39, 59))),
                                  (self.tournaments, TOURNAMENT_RECORD, ((9, 49), (49, 79)))):
            if len(data) <= 0x18:
                continue
            start = _record_base(data)
            for offset in range(start, len(data) - size + 1, size):
                fields.extend(data[offset + a:offset + b] for a, b in spans)
        return fields

    def player(self, number: int) -> str:
        offset = _record_base(self.players) + number * PLAYER_RECORD
        record = self.players[offset:offset + PLAYER_RECORD]
        last, first = _text(record[9:39], self.encoding), _text(record[39:59], self.encoding)
        return f"{last}, {first}" if first else last

    def tournament(self, number: int) -> tuple[str, str]:
        offset = _record_base(self.tournaments) + number * TOURNAMENT_RECORD
        record = self.tournaments[offset:offset + TOURNAMENT_RECORD]
        return _text(record[9:49], self.encoding), _text(record[49:79], self.encoding)

    def header(self, record: bytes) -> Header:
        """
        Заголовок партии из записи индекса: номера игроков и турнира, упакованная дата, тур, результат и рейтинги.
        """
        def u24(at: int) -> int:
            return int.from_bytes(record[at:at + 3], "big")

        packed = u24(24)
        year, month, day = packed >> 9, (packed >> 5) & 0xF, packed & 0x1F
        date = f"{year:04d}" if year else "????"
        date += f".{month:02d}" if month else ".??"
        date += f".{day:02d}" if day else ".??"
        event, site = self.tournament(u24(15))
        round_no, subround = record[29], record[30]
        white_elo, black_elo = struct.unpack(">HH", record[31:35])
        return Header(
            white=self.player(u24(9)), black=self.player(u24(12)), event=event, site=site, date=date,
            round=(f"{round_no}({subround})" if subround else str(round_no)) if round_no else "",
            result={2: "1-0", 1: "1/2-1/2", 0: "0-1"}.get(record[27], "*"),
            white_elo=white_elo, black_elo=black_elo,
        )

    def __iter__(self) -> Iterator[chess.pgn.Game]:
        for start in range(RECORD, len(self.index) - RECORD + 1, RECORD):
            record = self.index[start:start + RECORD]
            if not record[0] & 0x01:
                continue  # не партия (текст)
            if record[0] & 0x80:
                self.stats.deleted += 1
                continue
            offset = struct.unpack(">I", record[1:5])[0]
            if offset + 4 > len(self.games):
                self.stats.errors += 1
                continue
            flags = struct.unpack(">I", self.games[offset:offset + 4])[0]
            length = flags & LENGTH
            if flags & (NOT_ENCODED | SPECIAL_ENCODING | CHESS960):
                self.stats.unsupported += 1
                continue
            if flags & NOT_INITIAL:
                self.stats.not_initial += 1
                continue
            try:
                moves = decode_moves(self.games[offset + 4:offset + length])
                header = self.header(record)
            except (DecodeError, IndexError, struct.error) as exc:
                self.stats.errors += 1
                if len(self.stats.reasons) < 20:
                    self.stats.reasons.append(f"record {start // RECORD}: {exc}")
                continue
            if not moves:
                continue
            game = chess.pgn.Game()
            for name, value in (("Event", header.event), ("Site", header.site), ("Date", header.date),
                                ("Round", header.round), ("White", header.white), ("Black", header.black),
                                ("Result", header.result)):
                game.headers[name] = value or "?"
            if header.white_elo:
                game.headers["WhiteElo"] = str(header.white_elo)
            if header.black_elo:
                game.headers["BlackElo"] = str(header.black_elo)
            node: chess.pgn.GameNode = game
            for move in moves:
                node = node.add_variation(move)
            self.stats.games += 1
            yield game
