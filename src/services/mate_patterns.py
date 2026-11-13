# --- FILE: src/services/mate_patterns.py ---
"""
Именные матовые конструкции по финальной позиции (таск 13.4): у задач базы lichess нет тегов для части матов
раздела F каталога — их распознаёт этот модуль по расположению фигур в матовой позиции. Распознаются только
конструкции с однозначным определением; спорные (мат Пильсбери, мат Легаля как последовательность) не
угадываются — лучше без пометки, чем с ошибочной.

* ``queen_kiss_mate`` — ферзь матует вплотную к королю и защищён своей фигурой;
* ``damiano_mate`` — то же, ферзь на крайней вертикали защищён пешкой;
* ``lolli_mate`` — то же, ферзь не на краю защищён пешкой;
* ``epaulette_mate`` — ферзь матует с двух полей по вертикали, по бокам короля — его же фигуры;
* ``opera_mate`` — ладья матует вплотную по последней горизонтали короля, защищена слоном;
* ``corridor_mate`` — ладья/ферзь матует вдоль крайней вертикали, выход в сторону закрыт своими фигурами;
* ``greco_mate`` — король в углу, ладья/ферзь матует по крайней вертикали, слон отнимает поле рядом;
* ``morphy_mate`` — король в углу, мат слоном, ладья отнимает соседнюю вертикаль;
* ``blackburne_mate`` — мат слоном у рокированного короля при участии второго слона и коня.
"""

import chess

CORNERS = {chess.A1, chess.A8, chess.H1, chess.H8}
EDGE_FILES = {0, 7}


def _distance(a: chess.Square, b: chess.Square) -> int:
    return chess.square_distance(a, b)


def _flights(board: chess.Board, king: chess.Square) -> list[chess.Square]:
    return [s for s in chess.SQUARES if _distance(s, king) == 1]


def mate_patterns(board: chess.Board, last_move: chess.Move) -> list[str]:
    """Именные конструкции матовой позиции (после ``last_move``); не мат — пусто."""
    if not board.is_checkmate():
        return []
    mated = board.turn
    attacker = not mated
    king = board.king(mated)
    mover = board.piece_at(last_move.to_square)
    if king is None or mover is None:
        return []
    m = last_move.to_square
    protectors = [board.piece_at(s) for s in board.attackers(attacker, m)]
    protector_types = {p.piece_type for p in protectors if p is not None}
    flights = _flights(board, king)
    back_rank = 0 if mated == chess.WHITE else 7
    k_file, k_rank = chess.square_file(king), chess.square_rank(king)
    m_file, m_rank = chess.square_file(m), chess.square_rank(m)
    found: list[str] = []

    if mover.piece_type == chess.QUEEN and _distance(m, king) == 1 and protector_types:
        found.append("queen_kiss_mate")
        if chess.PAWN in protector_types:
            found.append("damiano_mate" if m_file in EDGE_FILES else "lolli_mate")

    if mover.piece_type == chess.QUEEN and m_file == k_file and abs(m_rank - k_rank) == 2:
        sides = [chess.square(k_file + d, k_rank) for d in (-1, 1) if 0 <= k_file + d < 8]
        if len(sides) == 2 and all(board.color_at(s) == mated and board.piece_type_at(s) != chess.PAWN for s in sides):
            found.append("epaulette_mate")

    if (mover.piece_type == chess.ROOK and k_rank == back_rank and m_rank == k_rank and _distance(m, king) == 1
            and chess.BISHOP in protector_types):
        found.append("opera_mate")

    if mover.piece_type in (chess.ROOK, chess.QUEEN) and k_file in EDGE_FILES and m_file == k_file \
            and _distance(m, king) >= 2:
        side = [s for s in flights if chess.square_file(s) != k_file]
        if side and all(board.color_at(s) == mated for s in side):
            found.append("corridor_mate")

    if king in CORNERS and mover.piece_type in (chess.ROOK, chess.QUEEN) and m_file == k_file:
        rank_flights = [s for s in flights if chess.square_rank(s) == k_rank]
        if any(board.piece_type_at(a) == chess.BISHOP for s in rank_flights for a in board.attackers(attacker, s)):
            found.append("greco_mate")

    if king in CORNERS and mover.piece_type == chess.BISHOP:
        file_flights = [s for s in flights if chess.square_file(s) != k_file]
        if any(board.piece_type_at(a) == chess.ROOK for s in file_flights for a in board.attackers(attacker, s)):
            found.append("morphy_mate")

    if mover.piece_type == chess.BISHOP and k_rank == back_rank and k_file >= 5:
        helpers = {board.piece_type_at(a) for s in flights for a in board.attackers(attacker, s) if a != m}
        if chess.BISHOP in helpers and chess.KNIGHT in helpers:
            found.append("blackburne_mate")

    return found


def patterns_for_solution(fen: str, moves: list[str]) -> list[str]:
    """Конструкции финальной позиции решения задачи (если решение кончается матом)."""
    board = chess.Board(fen)
    for uci in moves:
        board.push_uci(uci)
    return mate_patterns(board, board.peek()) if board.move_stack else []
